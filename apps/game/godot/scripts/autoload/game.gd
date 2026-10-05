extends Node
## Game (autoload) — world entry flow and state fan-out, on quickdraw
## protocol v5.
##
## Client ordering contract (see .claude/rules/game-patterns.md), on every
## (re)connect — a new socket is in no room until a call joins it:
##   world stream (gameService "world")  → snapshots, seeded with the world now
##   watchWorld / joinGame              → bootstrap state; puts THIS socket in
##                                        the world's room (its events, and
##                                        the input channel's requirement)
##   channel input / world events       → gameplay
##
## On the web the game boots into SPECTATE mode (watchWorld — world renders,
## nothing spawns); the React pre-game dialog calls gameService.joinGame on
## the page's own socket, and this client notices itself in the next snapshot
## and spawns. Signed-out visitors spectate too: watchWorld and the world
## stream are public. That is the point of the demo: commands are ordinary
## quickdraw methods callable from any surface. In the editor (no wrapper)
## the game auto-joins for fast iteration.

signal world_ready(bootstrap: Dictionary)
signal join_failed(error: String)
signal snapshot_received(snapshot: Dictionary)
signal player_joined(meta: Dictionary)
signal player_left(id: String)
signal player_died(death: Dictionary)
signal leaderboard_updated(entries: Array)

var world_id := ""
var chat_id := ""
var my_id := ""
var bounds := Vector2(2400, 2400)
var is_in_world := false

## ── World clock — shared server-timeline estimate ─────────────────────────
## Port of the bench harness's WorldClock (apps/api/src/bench/bot/
## world-clock.ts): anchors on a rolling min of (arrival − send) using the
## snapshot's `t` stamp, free-runs on the local clock between snapshots,
## slew-limited corrections. Replaces remote_snake.gd's per-entity
## estimators; falls back to a frame-rate-independent nudge when the server
## sends no timestamp. Keep the two implementations in lockstep.

const CLOCK_TAU_S := 0.3
const CLOCK_WINDOW_S := 4.0
const CLOCK_MAX_SLEW_TICKS_PER_S := 2.0
const INTERP_DELAY_TICKS := 2.5

## The server whose world the clock follows (its hello's `serverId`): a
## reconnect to another one reached a restarted server (a new world, ticks
## from 0), and the clock starts over; a network blip keeps it.
var _clock_server_id := ""
var _clock_est := 0.0
var _clock_latest := 0.0
var _clock_has_est := false
## Parallel arrays (PackedFloat64 — Vector2 is float32 and would quantize
## epoch-ms deltas to ~131s!): local arrival ms / (arrival − send) delay ms
var _clock_arrivals := PackedFloat64Array()
var _clock_delays := PackedFloat64Array()
var _clock_last_tick := 0.0
var _clock_last_send_t := 0.0
var _clock_has_timestamps := false


func clock_observe(tick: int, send_t: float) -> void:
	_clock_latest = maxf(_clock_latest, float(tick))
	if not _clock_has_est:
		_clock_est = float(tick)
		_clock_has_est = true
	if send_t <= 0.0:
		return
	var arrival := float(Time.get_ticks_msec())
	_clock_has_timestamps = true
	if float(tick) >= _clock_last_tick:
		_clock_last_tick = float(tick)
		_clock_last_send_t = send_t
	_clock_arrivals.append(arrival)
	_clock_delays.append(arrival - send_t)
	var cutoff := arrival - CLOCK_WINDOW_S * 1000.0
	while not _clock_arrivals.is_empty() and _clock_arrivals[0] < cutoff:
		_clock_arrivals.remove_at(0)
		_clock_delays.remove_at(0)


## Follows the world of the server `server_id` names: another server's ticks
## start over, so the clock forgets its timeline.
func clock_follow_server(server_id: String) -> void:
	if server_id != _clock_server_id:
		_clock_server_id = server_id
		_clock_reset()


## Forgets the timeline: the next snapshot anchors it again.
func _clock_reset() -> void:
	_clock_est = 0.0
	_clock_latest = 0.0
	_clock_has_est = false
	_clock_arrivals.clear()
	_clock_delays.clear()
	_clock_last_tick = 0.0
	_clock_last_send_t = 0.0
	_clock_has_timestamps = false


func _process(delta: float) -> void:
	if not _clock_has_est:
		return
	if not _clock_has_timestamps:
		# Fallback: frame-rate-independent nudge toward the freshest tick
		_clock_est += delta * GameConfig.TICK_RATE
		var k := 1.0 - exp(-delta / CLOCK_TAU_S)
		_clock_est += (_clock_latest - _clock_est) * k
		return
	var min_delay := INF
	for delay in _clock_delays:
		min_delay = minf(min_delay, delay)
	if min_delay == INF:
		return
	var target := (
		_clock_last_tick
		+ (float(Time.get_ticks_msec()) - min_delay - _clock_last_send_t)
		* GameConfig.TICK_RATE / 1000.0
	)
	_clock_est += delta * GameConfig.TICK_RATE
	var err := target - _clock_est
	var max_step := CLOCK_MAX_SLEW_TICKS_PER_S * delta
	_clock_est += clampf(err, -max_step, max_step)


func has_render_tick() -> bool:
	return _clock_has_est


func render_tick() -> float:
	return _clock_est - INTERP_DELAY_TICKS


func _ready() -> void:
	Net.ready_to_join.connect(_on_ready_to_join)
	if Net.client != null:
		Net.client.disconnected.connect(_on_disconnected)
		Net.client.stream_item.connect(_on_stream_item)
		Net.client.stream_seeded.connect(_on_stream_seeded)
		_wire_events()


func _on_ready_to_join() -> void:
	# The hello names the server (a restarted one has a new id and a new
	# world) and the user the socket acts for (null when anonymous); spectate
	# mode never calls joinGame, so this is where my_id comes from.
	clock_follow_server(Net.client.server_id)
	my_id = "" if Net.client.user_id == null else str(Net.client.user_id)
	_enter_world()


func _on_disconnected(_reason: String) -> void:
	is_in_world = false


var _entering := false


func _enter_world() -> void:
	if _entering:
		return
	_entering = true
	await _enter_world_once()
	_entering = false


func _enter_world_once() -> void:
	await _load_tunables()

	var world: Dictionary = await Net.client.call_method(
		"gameService", "getWorld", {"slug": Net.world_slug}
	)
	if not world.get("ok", false) or world.get("d") == null:
		join_failed.emit(_error_of(world, "World not found"))
		return
	world_id = str((world["d"] as Dictionary)["id"])

	# The world stream first, so its snapshots supersede the bootstrap below.
	# Once: the client holds the feed, subscribes again by itself after a
	# reconnect, and stream_seeded hands over the current world each time.
	if not Net.client.is_subscribed("gameService", "world", world_id):
		var sub: Dictionary = await Net.client.subscribe_stream("gameService", "world", world_id)
		if not sub.get("ok", false):
			# A refused feed is not held (is_subscribed is false): the retry
			# subscribes again. One lost with the connection stays held, and
			# the client subscribes it again after the reconnect
			join_failed.emit(_error_of(sub, "The world stream refused"))
			return

	# Web: spectate (the wrapper's dialog decides when to spawn).
	# Editor/desktop: auto-join for fast gameplay iteration. Either one puts
	# this socket in the world's room, which the input channel requires.
	var method := "joinGame" if Net.auto_spawn else "watchWorld"
	var entry: Dictionary = await Net.client.call_method(
		"gameService", method, {"worldId": world_id}
	)
	if not entry.get("ok", false):
		join_failed.emit(_error_of(entry, "Failed to enter world"))
		return

	var bootstrap := entry["d"] as Dictionary
	chat_id = str(bootstrap.get("chatId", ""))
	var b := bootstrap["bounds"] as Dictionary
	bounds = Vector2(float(b["w"]), float(b["h"]))
	is_in_world = true

	world_ready.emit(bootstrap)
	Net.notify_web_ready()


## A failed reply's `e`, as "CODE: message".
func _error_of(reply: Dictionary, fallback: String) -> String:
	var error: Variant = reply.get("e")
	if error is Dictionary:
		return "%s: %s" % [(error as Dictionary).get("code", ""), (error as Dictionary).get("message", "")]
	return fallback


## Fetch movement tunables from DefinitionService so the client predicts
## with the same values the server simulates with. Falls back to the
## GameConfig defaults if the definition is missing.
func _load_tunables() -> void:
	var result: Dictionary = await Net.client.call_method(
		"definitionService", "getDefinition", {"type": "tunables", "key": "snake"}
	)
	if result.get("ok", false) and result.get("d") is Dictionary:
		var definition := result["d"] as Dictionary
		if definition.get("data") is Dictionary:
			GameConfig.apply_tunables(definition["data"] as Dictionary)


## A snapshot pushed to the world stream (`qd:stream`, 20Hz, volatile).
func _on_stream_item(service: String, stream: String, _scope: String, item: Variant) -> void:
	if service == "gameService" and stream == "world" and item is Dictionary:
		var snapshot := item as Dictionary
		clock_observe(int(snapshot.get("tick", 0)), float(snapshot.get("t", 0.0)))
		if Bench.enabled:
			Bench.on_snapshot(int(snapshot.get("tick", 0)))
		snapshot_received.emit(snapshot)


## The world stream's seed, on subscribing and after every reconnect: the
## world now (every snake, all the food), which the snapshots that follow
## change, before the bootstrap lands. Not a tick's arrival (it carries no
## send time), so the clock skips it.
func _on_stream_seeded(service: String, stream: String, _scope: String, seed: Array) -> void:
	if service != "gameService" or stream != "world":
		return
	for item in seed:
		if item is Dictionary:
			snapshot_received.emit(item as Dictionary)


## The world's reliable events (`qd:event`), heard while this socket is in its room.
func _wire_events() -> void:
	Net.client.on_event("gameService", "playerJoined", func(meta: Variant) -> void:
		if meta is Dictionary:
			player_joined.emit(meta as Dictionary))
	Net.client.on_event("gameService", "playerLeft", func(left: Variant) -> void:
		if left is Dictionary:
			player_left.emit(str((left as Dictionary).get("id", ""))))
	Net.client.on_event("gameService", "death", func(death: Variant) -> void:
		if death is Dictionary:
			player_died.emit(death as Dictionary))
	Net.client.on_event("gameService", "leaderboard", func(entries: Variant) -> void:
		if entries is Array:
			leaderboard_updated.emit(entries as Array))


func send_input(seq: int, dir: Vector2, boost: bool) -> void:
	if not is_in_world:
		return
	if Bench.enabled:
		Bench.on_input(seq)
	# `qd:ch`: fire and forget, never acknowledged; the server drops it unless
	# this socket is in the world's room
	Net.client.send_channel("gameService", "input", {
		"seq": seq,
		"dx": dir.x,
		"dy": dir.y,
		"boost": boost,
	})


## Commands stay quickdraw methods — the same call a React button makes.
func respawn() -> void:
	if world_id.is_empty():
		return
	await Net.client.call_method("gameService", "respawn", {"worldId": world_id})
