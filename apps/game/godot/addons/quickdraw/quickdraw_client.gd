class_name QuickdrawClient
extends Node
## A quickdraw protocol v5 client for Godot 4, written from
## docs/protocol-v5.md: Socket.IO over a WebSocket, JSON only, no Socket.IO
## library. It calls methods, sends on channels, hears typed events, stream
## items and presence, and reconnects with a fresh handshake.
##
## Add it as an autoload (Project Settings > Globals > Autoload:
## res://addons/quickdraw/quickdraw_client.gd as "Quickdraw"), or as a child
## node, then:
##
##     Quickdraw.connected.connect(_on_connected)
##     Quickdraw.connect_to("https://api.example.com", {"token": token})
##
##     func _on_connected(hello: Dictionary) -> void:
##         var reply := await Quickdraw.call_method("gameService", "join", {"name": "ada"})
##         if reply.ok:
##             Quickdraw.send_channel("gameService", "move", {"dx": 1, "dy": 0})
##
## App rooms are per socket: `connected` fires again after every reconnect,
## and the new socket is in no room until a call joins it, so join there.
## Numbers in replies and frames arrive as floats (Godot's JSON).

## `qd:hello` arrived: the socket is ready, again after each reconnect.
signal connected(hello: Dictionary)
## The socket closed. The client reconnects unless `close()` or the server ended it.
signal disconnected(reason: String)
## The handshake was refused (`PROTOCOL_MISMATCH`, `UNAUTHENTICATED`): no reconnect.
signal refused(code: String, message: String)
## A typed room event (`qd:event`).
signal event_received(service: String, event: String, payload: Variant)
## An item pushed to a subscribed stream (`qd:stream`); `scope` is "" for a global stream.
signal stream_item(service: String, stream: String, scope: String, item: Variant)
## A stream's seed, on subscribing and on each resubscribe after a reconnect: it replaces what you held.
signal stream_seeded(service: String, stream: String, scope: String, seed: Array)
## Who is in an app room the socket is in, after a `qd:presence` frame.
signal presence_changed(room: String, users: Array)
## The server ended a subscription (`qd:revoked`).
signal revoked(frame: Dictionary)
## The server asked the client to reconnect (`qd:rotate`): the socket stays
## open, calls still answered, until a random moment within `within_ms`; then
## the client reconnects and `connected` fires again.
signal rotating(within_ms: int)
## The user's service grants changed (`qd:access`).
signal access_changed(service_access: Dictionary)
## Every other server event (`qd:e`, `qd:c`, `qd:changed`), for frames this client does not route.
signal frame_received(event: String, data: Variant)

const PROTOCOL := 5
const CLIENT := "quickdraw-gdscript/5.0.0"
## A RATE_LIMITED reply without `retryAfterMs` waits this long (docs/protocol-v5.md, Limits).
const DEFAULT_BACKOFF_MS := 5000
## After a lost connection the client waits a random time up to this (full
## jitter), doubling after each failed attempt up to RECONNECT_MAX_S.
const RECONNECT_MIN_S := 1.0
const RECONNECT_MAX_S := 15.0
## Frames waiting to be read hold at most this many bytes: a reply as large as
## the server's default `maxResponseBytes` (1 MiB) with its envelope, and the
## frames that arrive with it. Godot drops a frame that does not fit.
const INBOUND_BUFFER_BYTES := 1 << 21
## And at most this many frames.
const MAX_QUEUED_PACKETS := 4096
## An acknowledgement nobody takes with `reply` is dropped after this long
## (a call started with `start_call` and never awaited, a refusal, a failure
## when the connection was lost)...
const UNCLAIMED_REPLY_MS := 60000
## ...or sooner, the oldest first, when more than this many wait.
const MAX_UNCLAIMED_REPLIES := 256
## A channel message is dropped, not queued, while more than this waits to be sent (volatile).
const BACKED_UP_BYTES := 65536
const SUBSCRIPTION_EVENTS := ["qd:sub", "qd:col:sub", "qd:col:items", "qd:watch", "qd:stream:sub"]

enum State { IDLE, CONNECTING, HANDSHAKE, READY, CLOSED }

var state := State.IDLE
## The server's `qd:hello`: `protocol`, `server`, `limits`, `features`, `userId`, `serviceAccess`.
var hello: Dictionary = {}
## The user the socket acts for, or null when anonymous.
var user_id: Variant = null
var service_access: Dictionary = {}
## Print every frame sent (`>> `) and received (`<< `), pings and pongs aside.
var trace := false
## Draws the client's random waits: the reconnect backoff, the moment a
## `qd:rotate` chooses, and the spread of a RATE_LIMITED backoff. Seed it to
## repeat a run.
var rng := RandomNumberGenerator.new()

var _ws := WebSocketPeer.new()
var _url := ""
var _auth: Dictionary = {}
var _headers := PackedStringArray()
var _reconnect := true
var _reconnect_delay := RECONNECT_MIN_S
var _reconnect_at_ms := 0
var _rotate_at_ms := 0  # when to leave for a `qd:rotate`, while one is due
var _lost_at_ms := 0
var _heartbeat_ms := 45000
var _next_id := 0
var _replies: Dictionary = {}  # ack id -> [the acknowledgement, when it arrived], until `reply` takes it
var _awaited: Dictionary = {}  # ack ids a `reply` waits for
var _deadlines: Dictionary = {}  # ack id -> when to stop waiting, while in flight
var _lane: Dictionary = {}  # ack ids of subscription events awaiting their acknowledgement
var _backoff_until := {"call": 0, "subscription": 0}
var _streams: Dictionary = {}  # "service/stream/scope" -> the qd:stream:sub frame
var _rooms: Dictionary = {}  # room -> {user id: true}
var _handlers: Dictionary = {}  # "service/event" -> [Callable]


func _init() -> void:
	rng.randomize()


## Connects to `base_url` ("https://api.example.com"). Options: `token`, sent
## as `auth.token`; `auth`, more keys for the server's `authenticate`; `path`,
## the Socket.IO path (default "/socket.io"); `headers`, a PackedStringArray
## for the WebSocket handshake ("Cookie: session=..."; not on the web, where
## the browser sends cookies); `reconnect` (default true). A client already
## connected closes that socket first.
func connect_to(base_url: String, options: Dictionary = {}) -> void:
	if state != State.IDLE and state != State.CLOSED:
		close()
	var secure := base_url.begins_with("https://")
	var host := base_url.trim_prefix("https://").trim_prefix("http://").trim_suffix("/")
	var path: String = options.get("path", "/socket.io")
	_url = "%s://%s%s/?EIO=4&transport=websocket" % ["wss" if secure else "ws", host, path]
	_auth = (options.get("auth", {}) as Dictionary).duplicate()
	if options.has("token"):
		_auth["token"] = options["token"]
	_auth["qd"] = {"protocol": PROTOCOL, "client": CLIENT}
	_headers = options.get("headers", PackedStringArray())
	_reconnect = options.get("reconnect", true)
	_reconnect_delay = RECONNECT_MIN_S
	_open()


## Ends the socket for good: no reconnect. Calls waiting fail with INTERNAL.
func close() -> void:
	_reconnect = false
	if state == State.READY or state == State.HANDSHAKE:
		_send("41")
	_ws.close()
	_lost("io client disconnect", false)


func is_ready() -> bool:
	return state == State.READY


## Calls `service.method(input)` and returns the acknowledgement:
## {ok: true, d: <output>}, {ok: true, nm: true, v} (not modified), or
## {ok: false, e: {code, message, data?}}. A call refused here, without a
## frame (not connected, or backing off after RATE_LIMITED), fails the same way.
func call_method(service: String, method: String, input: Variant = null, version: Variant = null) -> Dictionary:
	return await reply(start_call(service, method, input, version))


## Sends a call and returns its id at once, for `cancel_call`; `await reply(id)` answers it.
func start_call(service: String, method: String, input: Variant = null, version: Variant = null) -> int:
	var id := _take_id()
	var refusal := _refusal("call")
	if not refusal.is_empty():
		_keep_reply(id, refusal)
		return id
	var envelope := {"id": id, "s": service, "m": method}
	if input != null:
		envelope["i"] = input
	if version != null:
		envelope["v"] = version
	_deadlines[id] = Time.get_ticks_msec() + _call_timeout_ms()
	_emit("qd:call", envelope, id)
	return id


## Waits for the acknowledgement of call or request `id`. One that arrived
## before is kept for `UNCLAIMED_REPLY_MS`, so `reply` may come later.
func reply(id: int) -> Dictionary:
	_awaited[id] = true
	while not _replies.has(id):
		if not _deadlines.has(id) or Time.get_ticks_msec() > int(_deadlines[id]):
			_deadlines.erase(id)
			_lane.erase(id)
			_awaited.erase(id)
			return _failure("TIMEOUT", "No acknowledgement in time")
		await get_tree().process_frame
	_awaited.erase(id)
	var answer: Dictionary = _replies[id][0]
	_replies.erase(id)
	_note_rate_limit(answer, "subscription" if _lane.has(id) else "call")
	_lane.erase(id)
	return answer


## Asks the server to abort call `id`; its acknowledgement still arrives (CANCELLED).
func cancel_call(id: int) -> void:
	if state == State.READY and _deadlines.has(id):
		_emit("qd:cancel", {"id": id})


## Sends on a channel: fire and forget. Never acknowledged, never answered:
## the server drops a message over the channel's rate, failing its schema or
## its `requires` without a word. Returns false when the message was dropped
## here (not connected, or the connection is backed up).
func send_channel(service: String, channel: String, payload: Variant) -> bool:
	if state != State.READY or _ws.get_current_outbound_buffered_amount() > BACKED_UP_BYTES:
		return false
	_emit("qd:ch", [service, channel, payload])
	return true


## Subscribes to a stream (one scope of it, for a scoped stream) and returns
## the acknowledgement, {ok: true, seed: [...]}. Items then arrive as
## `stream_item`; after a reconnect the client subscribes again by itself.
func subscribe_stream(service: String, stream: String, scope := "") -> Dictionary:
	var frame := {"s": service, "stream": stream}
	if scope != "":
		frame["scope"] = scope
	_streams[_stream_key(service, stream, scope)] = frame
	var answer := await request("qd:stream:sub", frame)
	if answer.get("ok", false):
		stream_seeded.emit(service, stream, scope, answer.get("seed", []))
	return answer


func unsubscribe_stream(service: String, stream: String, scope := "") -> void:
	var frame: Variant = _streams.get(_stream_key(service, stream, scope))
	_streams.erase(_stream_key(service, stream, scope))
	if frame != null and state == State.READY:
		_emit("qd:stream:unsub", frame)


## Calls `callback(payload)` for each `qd:event` of `service` named `event`.
func on_event(service: String, event: String, callback: Callable) -> void:
	var key := "%s/%s" % [service, event]
	if not _handlers.has(key):
		_handlers[key] = []
	(_handlers[key] as Array).append(callback)


## The users in an app room the socket is in, as its `qd:presence` frames said.
func presence(room: String) -> Array:
	return (_rooms.get(room, {}) as Dictionary).keys()


## Sends any acknowledged event of the protocol and waits for its acknowledgement.
## Subscription events wait for a place in the lane `hello.limits.subscriptions` allows.
func request(event: String, payload: Variant) -> Dictionary:
	var kind := "subscription" if SUBSCRIPTION_EVENTS.has(event) else "call"
	while kind == "subscription" and state == State.READY and _lane.size() >= _lane_limit():
		await get_tree().process_frame
	var id := _take_id()
	var refusal := _refusal(kind)
	if not refusal.is_empty():
		return refusal
	if kind == "subscription":
		_lane[id] = true
	_deadlines[id] = Time.get_ticks_msec() + _call_timeout_ms()
	_emit(event, payload, id)
	return await reply(id)


# --- Connection --------------------------------------------------------------


func _open() -> void:
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = INBOUND_BUFFER_BYTES
	_ws.max_queued_packets = MAX_QUEUED_PACKETS
	_ws.outbound_buffer_size = 1 << 18
	if not _headers.is_empty():
		_ws.handshake_headers = _headers
	state = State.CONNECTING
	if _ws.connect_to_url(_url) != OK:
		_lost("transport error", true)


func _process(_delta: float) -> void:
	var now := Time.get_ticks_msec()
	if state == State.CLOSED or state == State.IDLE:
		if _reconnect and _reconnect_at_ms > 0 and now >= _reconnect_at_ms:
			_reconnect_at_ms = 0
			_open()
		return
	if _rotate_at_ms > 0 and now >= _rotate_at_ms:
		_rotate()
		return
	_ws.poll()
	match _ws.get_ready_state():
		WebSocketPeer.STATE_OPEN:
			while _ws.get_available_packet_count() > 0:
				var packet := _ws.get_packet()
				if _ws.was_string_packet():
					_receive(packet.get_string_from_utf8())
			if state != State.CONNECTING and now > _lost_at_ms:
				_ws.close()
				_lost("ping timeout", true)
		WebSocketPeer.STATE_CLOSED:
			_lost("transport close", true)


## The moment a `qd:rotate` chose: leave, and connect again at once with a fresh handshake.
func _rotate() -> void:
	_send("41")
	_ws.close()
	_lost("rotate", false)
	if _reconnect:
		_reconnect_at_ms = maxi(1, Time.get_ticks_msec())


## The socket is gone: answer what waits, forget its rooms, and reconnect when wanted.
func _lost(reason: String, retry: bool) -> void:
	var was := state
	state = State.CLOSED
	_rotate_at_ms = 0
	for id in _deadlines.keys():
		_keep_reply(id, _failure("INTERNAL", "The connection was lost"))
	_deadlines.clear()
	_rooms.clear()
	if was == State.READY:
		disconnected.emit(reason)
	if retry and _reconnect:
		_reconnect_at_ms = Time.get_ticks_msec() + int(rng.randf_range(0.0, _reconnect_delay) * 1000.0)
		_reconnect_delay = minf(_reconnect_delay * 2.0, RECONNECT_MAX_S)


func _send(text: String) -> void:
	if trace and text != "3":
		print(">> ", text)
	_ws.send_text(text)


## `42["event",payload]`, or `42<id>["event",payload]` when it asks for an acknowledgement.
func _emit(event: String, payload: Variant, ack := -1) -> void:
	var head := "42" if ack < 0 else "42%d" % ack
	_send(head + JSON.stringify([event, payload]))


# --- Receiving ---------------------------------------------------------------


func _receive(text: String) -> void:
	if trace and text != "2":
		print("<< ", text)
	match text.substr(0, 1):
		"0":
			_on_open(JSON.parse_string(text.substr(1)))
		"2":
			_send("3")
			_lost_at_ms = Time.get_ticks_msec() + _heartbeat_ms
		"4":
			_on_packet(text.substr(1))


## Engine.IO OPEN: note the heartbeat, then connect with the handshake.
func _on_open(settings: Variant) -> void:
	if settings is Dictionary:
		_heartbeat_ms = int(settings.get("pingInterval", 25000)) + int(settings.get("pingTimeout", 20000))
	_lost_at_ms = Time.get_ticks_msec() + _heartbeat_ms
	state = State.HANDSHAKE
	_send("40" + JSON.stringify(_auth))


## A Socket.IO packet: its type, then (EVENT, ACK) an ack id's digits and a JSON array.
func _on_packet(text: String) -> void:
	var kind := text.substr(0, 1)
	match kind:
		"1":
			_ws.close()
			_lost("io server disconnect", false)
		"2", "3":
			var bracket := text.find("[")
			var body: Variant = JSON.parse_string(text.substr(bracket)) if bracket > 0 else null
			if not (body is Array) or (body as Array).is_empty():
				return
			if kind == "2":
				_on_event(str(body[0]), body[1] if (body as Array).size() > 1 else null)
			else:
				_on_ack(text.substr(1, bracket - 1).to_int(), body[0])
		"4":
			_on_refused(JSON.parse_string(text.substr(1)))


func _on_ack(id: int, answer: Variant) -> void:
	if _deadlines.has(id) and answer is Dictionary:
		_deadlines.erase(id)
		_keep_reply(id, answer)


func _on_refused(body: Variant) -> void:
	var data: Dictionary = body.get("data", {}) if body is Dictionary else {}
	var message: String = body.get("message", "") if body is Dictionary else ""
	_reconnect = false
	_ws.close()
	_lost("refused", false)
	refused.emit(str(data.get("code", "")), message)


func _on_event(event: String, data: Variant) -> void:
	match event:
		"qd:hello":
			_on_hello(data)
		"qd:event":
			_on_room_event(data)
		"qd:stream":
			var item: Dictionary = data
			stream_item.emit(item.s, item.stream, item.get("scope", ""), item.get("item"))
		"qd:presence":
			_on_presence(data)
		"qd:revoked":
			if data.get("kind") == "stream":
				_streams.erase(_stream_key(data.s, data.stream, data.get("scope", "")))
			revoked.emit(data)
		"qd:access":
			service_access = data.get("serviceAccess", {})
			access_changed.emit(service_access)
		"qd:rotate":
			# Stay on this socket until a random moment within the window, then
			# reconnect (`_rotate`), so the server's clients come back spread out.
			if _rotate_at_ms == 0:
				var within := maxi(0, int(data.get("withinMs", 0)))
				_rotate_at_ms = maxi(1, Time.get_ticks_msec() + rng.randi_range(0, within))
				rotating.emit(within)
		_:
			frame_received.emit(event, data)


func _on_hello(data: Variant) -> void:
	hello = data
	user_id = hello.get("userId")
	service_access = hello.get("serviceAccess", {})
	state = State.READY
	_reconnect_delay = RECONNECT_MIN_S
	for key in _streams.keys():
		_resubscribe(_streams[key])
	connected.emit(hello)


func _resubscribe(frame: Dictionary) -> void:
	var answer := await request("qd:stream:sub", frame)
	if answer.get("ok", false):
		stream_seeded.emit(frame.s, frame.stream, frame.get("scope", ""), answer.get("seed", []))


func _on_room_event(data: Variant) -> void:
	if not (data is Array) or (data as Array).size() < 3:
		return
	event_received.emit(data[0], data[1], data[2])
	for callback in _handlers.get("%s/%s" % [data[0], data[1]], []):
		(callback as Callable).call(data[2])


## `users` replaces the room's list, `joined` adds a user, `left` removes one.
func _on_presence(frame: Dictionary) -> void:
	var room: String = frame.room
	var users: Dictionary = _rooms.get(room, {})
	if frame.has("users"):
		users = {}
		for user in frame.users:
			users[user] = true
	if frame.has("joined"):
		users[frame.joined] = true
	if frame.has("left"):
		users.erase(frame.left)
	if users.is_empty():
		_rooms.erase(room)
	else:
		_rooms[room] = users
	presence_changed.emit(room, users.keys())


# --- Limits ------------------------------------------------------------------


func _take_id() -> int:
	var id := _next_id
	_next_id += 1
	return id


## Keeps the acknowledgement of `id` until `reply` takes it. One nobody awaits
## is dropped once it is UNCLAIMED_REPLY_MS old, or when more than
## MAX_UNCLAIMED_REPLIES wait, the oldest first.
func _keep_reply(id: int, answer: Dictionary) -> void:
	var now := Time.get_ticks_msec()
	_replies[id] = [answer, now]
	for old in _replies.keys():
		if _replies.size() <= MAX_UNCLAIMED_REPLIES and now - int(_replies[old][1]) < UNCLAIMED_REPLY_MS:
			break
		if not _awaited.has(old):
			_replies.erase(old)


func _call_timeout_ms() -> int:
	return int(hello.get("limits", {}).get("callTimeoutMs", 30000)) + 2000


func _lane_limit() -> int:
	return int(hello.get("limits", {}).get("subscriptions", {}).get("maxInFlight", 8))


## Why a call or subscription is refused here, without a frame, or {} when it may go.
func _refusal(kind: String) -> Dictionary:
	if state != State.READY:
		return _failure("INTERNAL", "Not connected")
	if Time.get_ticks_msec() < int(_backoff_until[kind]):
		return _failure("RATE_LIMITED", "Backing off after RATE_LIMITED")
	return {}


## A RATE_LIMITED reply pauses that kind of work for `retryAfterMs` and up to half again.
func _note_rate_limit(answer: Dictionary, kind: String) -> void:
	var error: Dictionary = answer.get("e", {}) if not answer.get("ok", true) else {}
	if error.get("code") != "RATE_LIMITED" or error.get("message") == "Backing off after RATE_LIMITED":
		return
	var data: Variant = error.get("data")
	var wait := float(data.get("retryAfterMs", DEFAULT_BACKOFF_MS)) if data is Dictionary else float(DEFAULT_BACKOFF_MS)
	wait = clampf(wait, 250.0, 300000.0)
	_backoff_until[kind] = Time.get_ticks_msec() + int(wait * rng.randf_range(1.0, 1.5))


func _failure(code: String, message: String) -> Dictionary:
	return {"ok": false, "e": {"code": code, "message": message}}


func _stream_key(service: String, stream: String, scope: String) -> String:
	return "%s/%s/%s" % [service, stream, scope]
