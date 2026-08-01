extends Node
## Game (autoload) — world entry flow and state fan-out.
##
## Client ordering contract (see .claude/rules/game-patterns.md):
##   subscribe("gameService", worldId)  → room membership (gates everything)
##   watchWorld / joinGame              → bootstrap state
##   channel input / snapshot events    → gameplay
##
## On the web the game boots into SPECTATE mode (watchWorld — world renders,
## nothing spawns); the React pre-game dialog calls gameService.joinGame on
## the page's own socket, and this client notices itself in the next snapshot
## and spawns. Signed-out visitors spectate too: subscribe fails without
## auth, but watchWorld grants world-room membership to anonymous sockets. That is the point of the demo: commands are ordinary quickdraw
## methods callable from any surface. In the editor (no wrapper) the game
## auto-joins for fast iteration.

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
		# The server pushes identity on connect; spectate mode never calls
		# joinGame, so this is where my_id comes from.
		Net.client.on_event("auth:info", func(data: Variant) -> void:
			if data is Dictionary:
				my_id = str((data as Dictionary).get("userId", "")))


func _on_ready_to_join() -> void:
	_enter_world()


func _on_disconnected() -> void:
	is_in_world = false


func _enter_world() -> void:
	await _load_tunables()

	var world: Dictionary = await Net.client.call_method(
		"gameService", "getWorld", {"slug": Net.world_slug}
	)
	if not world.get("success", false) or world.get("data") == null:
		join_failed.emit(str(world.get("error", "World not found")))
		return
	world_id = str((world["data"] as Dictionary)["id"])

	var sub: Dictionary = await Net.client.subscribe("gameService", world_id)
	if not sub.get("success", false):
		# Anonymous spectators can't subscribe (registry requires auth) —
		# watchWorld below grants world-room membership instead. Only the
		# auto-spawn (editor/desktop) path treats this as fatal.
		if Net.auto_spawn:
			join_failed.emit(str(sub.get("error", "Subscribe failed")))
			return

	_wire_events()

	# Web: spectate (the wrapper's dialog decides when to spawn).
	# Editor/desktop: auto-join for fast gameplay iteration.
	var method := "joinGame" if Net.auto_spawn else "watchWorld"
	var entry: Dictionary = await Net.client.call_method(
		"gameService", method, {"worldId": world_id}
	)
	if not entry.get("success", false):
		join_failed.emit(str(entry.get("error", "Failed to enter world")))
		return

	var bootstrap := entry["data"] as Dictionary
	chat_id = str(bootstrap.get("chatId", ""))
	var b := bootstrap["bounds"] as Dictionary
	bounds = Vector2(float(b["w"]), float(b["h"]))
	is_in_world = true

	world_ready.emit(bootstrap)
	Net.notify_web_ready()


## Fetch movement tunables from DefinitionService so the client predicts
## with the same values the server simulates with. Falls back to the
## GameConfig defaults if the definition is missing.
func _load_tunables() -> void:
	var result: Dictionary = await Net.client.call_method(
		"definitionService", "getDefinition", {"type": "tunables", "key": "snake"}
	)
	if result.get("success", false) and result.get("data") is Dictionary:
		var definition := result["data"] as Dictionary
		if definition.get("data") is Dictionary:
			GameConfig.apply_tunables(definition["data"] as Dictionary)


var _events_wired := false


func _wire_events() -> void:
	if _events_wired:
		return
	_events_wired = true
	Net.client.on_event("game:snapshot", func(data: Variant) -> void:
		if data is Dictionary:
			var snap_dict := data as Dictionary
			clock_observe(int(snap_dict.get("tick", 0)), float(snap_dict.get("t", 0.0)))
			if Bench.enabled:
				Bench.on_snapshot(int(snap_dict.get("tick", 0)))
			snapshot_received.emit(snap_dict))
	Net.client.on_event("game:playerJoined", func(data: Variant) -> void:
		if data is Dictionary:
			player_joined.emit(data as Dictionary))
	Net.client.on_event("game:playerLeft", func(data: Variant) -> void:
		if data is Dictionary:
			player_left.emit(str((data as Dictionary).get("id", ""))))
	Net.client.on_event("game:death", func(data: Variant) -> void:
		if data is Dictionary:
			player_died.emit(data as Dictionary))
	Net.client.on_event("game:leaderboard", func(data: Variant) -> void:
		if data is Array:
			leaderboard_updated.emit(data as Array))


func send_input(seq: int, dir: Vector2, boost: bool) -> void:
	if not is_in_world:
		return
	if Bench.enabled:
		Bench.on_input(seq)
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
