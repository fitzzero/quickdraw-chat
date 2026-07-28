class_name QuickdrawClient
extends Node
## Minimal Socket.IO v4 client for quickdraw servers.
##
## Deliberately small: websocket transport only (no HTTP long-polling
## fallback), text frames only (no binary attachments). That subset of the
## Socket.IO protocol is stable and tiny — engine.io framing is a single
## leading digit, socket.io packets one more.
##
## Speaks the quickdraw wire contract:
##   method call   -> EVENT "service:method" + ack   {success, data|error}
##   subscribe     -> EVENT "service:subscribe" {entryId} + ack
##   channel send  -> EVENT "channel:service:name" (fire-and-forget, volatile-ish)
##   room events   -> plain EVENTs (game:snapshot, chat:message, ...)
##
## Auth rides the CONNECT packet ("40{...}") — {"userId": ...} for dev
## credentials in the editor, {"token": ...} for JWT (Discord Activity),
## or {} on the web where the browser attaches the session cookie to the
## websocket handshake automatically.

signal connected
signal disconnected
signal event_received(event_name: String, data: Variant)

enum State { IDLE, CONNECTING, OPEN, CONNECTED, CLOSED }

const ACK_TIMEOUT_S := 10.0
const RECONNECT_BASE_S := 1.0
const RECONNECT_MAX_S := 15.0

var state: int = State.IDLE

var _ws := WebSocketPeer.new()
var _base_url := ""
var _path := "/socket.io"
var _auth: Dictionary = {}
var _ack_id := 0
var _ack_results: Dictionary = {}
var _event_handlers: Dictionary = {}
var _reconnect_wanted := false
var _reconnect_delay := RECONNECT_BASE_S
var _reconnect_at_ms := 0


## Connect to a quickdraw server. base_url like "http://localhost:4000".
## opts: {"path": String, "auth": Dictionary}
func connect_to(base_url: String, opts: Dictionary = {}) -> void:
	_base_url = base_url
	_path = opts.get("path", "/socket.io")
	_auth = opts.get("auth", {})
	_reconnect_wanted = true
	_reconnect_delay = RECONNECT_BASE_S
	_open_socket()


func disconnect_from_server() -> void:
	_reconnect_wanted = false
	_ws.close()
	state = State.CLOSED


func is_socket_connected() -> bool:
	return state == State.CONNECTED


## Call a typed quickdraw service method and await its ack.
## Returns the response envelope: {"success": bool, "data"|"error": ...}.
func call_method(service: String, method: String, payload: Dictionary) -> Dictionary:
	return await _emit_with_ack("%s:%s" % [service, method], payload)


## Subscribe to an entity (joins its room server-side; ACL-checked there).
func subscribe(service: String, entry_id: String) -> Dictionary:
	return await _emit_with_ack("%s:subscribe" % service, {"entryId": entry_id})


func unsubscribe(service: String, entry_id: String) -> Dictionary:
	return await _emit_with_ack("%s:unsubscribe" % service, {"entryId": entry_id})


## Fire-and-forget channel message (high-frequency input). No ack, no error:
## the server validates, rate-limits, and access-checks silently.
func send_channel(service: String, channel: String, payload: Dictionary) -> void:
	if state != State.CONNECTED:
		return
	var event := "channel:%s:%s" % [service, channel]
	_ws.send_text("42%s" % JSON.stringify([event, payload]))


## Register a callback for a server event (room events, updates).
func on_event(event_name: String, callback: Callable) -> void:
	if not _event_handlers.has(event_name):
		_event_handlers[event_name] = []
	(_event_handlers[event_name] as Array).append(callback)


func off_event(event_name: String, callback: Callable) -> void:
	if _event_handlers.has(event_name):
		(_event_handlers[event_name] as Array).erase(callback)


# =============================================================================
# Internals
# =============================================================================


func _open_socket() -> void:
	_ws = WebSocketPeer.new()
	# Snapshots at tick rate can burst past the 64KB default while a tab is
	# briefly throttled; give ourselves generous headroom.
	_ws.inbound_buffer_size = 1024 * 1024
	_ws.outbound_buffer_size = 256 * 1024

	var scheme := "wss://" if _base_url.begins_with("https") else "ws://"
	var host := _base_url.trim_prefix("https://").trim_prefix("http://")
	var url := "%s%s%s/?EIO=4&transport=websocket" % [scheme, host, _path]

	state = State.CONNECTING
	var err := _ws.connect_to_url(url)
	if err != OK:
		push_warning("QuickdrawClient: connect_to_url failed (%s)" % err)
		_schedule_reconnect()


func _process(_delta: float) -> void:
	if state == State.CLOSED:
		_maybe_reconnect()
		return

	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			if state == State.CONNECTING:
				state = State.OPEN
			while _ws.get_available_packet_count() > 0:
				var packet := _ws.get_packet()
				if _ws.was_string_packet():
					_handle_frame(packet.get_string_from_utf8())
		WebSocketPeer.STATE_CLOSED:
			var was_connected := state == State.CONNECTED
			state = State.CLOSED
			_fail_pending_acks()
			if was_connected:
				disconnected.emit()
			_schedule_reconnect()
		_:
			pass


## engine.io framing: first char is the packet type.
func _handle_frame(msg: String) -> void:
	if msg.is_empty():
		return
	match msg[0]:
		"0":
			# OPEN {"sid", "pingInterval", "pingTimeout"} -> send socket.io
			# CONNECT with the auth object piggybacked.
			_ws.send_text("40%s" % JSON.stringify(_auth))
		"2":
			_ws.send_text("3")  # ping -> pong
		"4":
			_handle_socketio(msg.substr(1))
		_:
			pass


## socket.io packet: first char is the packet type, optional ack id digits,
## then a JSON array payload.
func _handle_socketio(msg: String) -> void:
	if msg.is_empty():
		return
	match msg[0]:
		"0":
			state = State.CONNECTED
			_reconnect_delay = RECONNECT_BASE_S
			connected.emit()
		"2":
			_handle_event_packet(msg.substr(1))
		"3":
			_handle_ack_packet(msg.substr(1))
		"4":
			push_warning("QuickdrawClient: connect_error %s" % msg.substr(1))
		_:
			pass


func _handle_event_packet(rest: String) -> void:
	var bracket := rest.find("[")
	if bracket == -1:
		return
	var parsed: Variant = JSON.parse_string(rest.substr(bracket))
	if not (parsed is Array) or (parsed as Array).is_empty():
		return
	var arr := parsed as Array
	var event_name := str(arr[0])
	var data: Variant = arr[1] if arr.size() > 1 else null

	event_received.emit(event_name, data)
	if _event_handlers.has(event_name):
		for callback: Callable in _event_handlers[event_name]:
			callback.call(data)


func _handle_ack_packet(rest: String) -> void:
	var bracket := rest.find("[")
	if bracket == -1:
		return
	var id := rest.substr(0, bracket).to_int()
	var parsed: Variant = JSON.parse_string(rest.substr(bracket))
	if parsed is Array:
		_ack_results[id] = parsed


func _emit_with_ack(event_name: String, payload: Dictionary) -> Dictionary:
	if state != State.CONNECTED:
		return {"success": false, "error": "Not connected"}

	_ack_id += 1
	var id := _ack_id
	_ws.send_text("42%d%s" % [id, JSON.stringify([event_name, payload])])

	var deadline := Time.get_ticks_msec() + int(ACK_TIMEOUT_S * 1000)
	while Time.get_ticks_msec() < deadline:
		if _ack_results.has(id):
			var response: Variant = _ack_results[id]
			_ack_results.erase(id)
			if response is Array and (response as Array).size() > 0:
				var envelope: Variant = (response as Array)[0]
				if envelope is Dictionary:
					return envelope as Dictionary
			return {"success": false, "error": "Malformed ack"}
		await get_tree().process_frame

	return {"success": false, "error": "Timeout waiting for %s" % event_name}


func _fail_pending_acks() -> void:
	# Waiters poll _ack_results and time out on their own; nothing queued
	# survives a reconnect because ack ids are connection-scoped server-side.
	_ack_results.clear()


func _schedule_reconnect() -> void:
	if not _reconnect_wanted:
		return
	# Exponential backoff with jitter, capped
	_reconnect_delay = minf(_reconnect_delay * 1.7, RECONNECT_MAX_S)
	var jitter := randf() * 0.4 + 0.8
	_reconnect_at_ms = Time.get_ticks_msec() + int(_reconnect_delay * jitter * 1000.0)


func _maybe_reconnect() -> void:
	if _reconnect_wanted and Time.get_ticks_msec() >= _reconnect_at_ms and _reconnect_at_ms > 0:
		_reconnect_at_ms = 0
		_open_socket()
