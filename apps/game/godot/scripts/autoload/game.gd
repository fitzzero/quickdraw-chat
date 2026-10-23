extends Node
## Game (autoload) — world entry flow and state fan-out, on quickdraw
## protocol v5.
##
## Client ordering contract (see .claude/rules/game-patterns.md), on every
## (re)connect — a new socket is in no room until a call joins it:
##   world stream (gameService "world")  → snapshots, packed, seeded with the
##                                        world now (SnapshotDecoder unpacks them)
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
##
## A party (host mode, Net.party_code) is another world, which a player's
## page hosts: joinParty puts this socket in the party's room, and the
## party's feeds (partyWorld: raw snapshots; partyEvents: joins, leaves,
## deaths, the leaderboard) and its input (partyInput) go to the room's host
## over a peer link the client opens itself (each call's `room`).

signal world_ready(bootstrap: Dictionary)
signal join_failed(error: String)
signal snapshot_received(snapshot: Dictionary)
## The world stream's seed: the world now, a keyframe whose food replaces the
## food a client holds (main.gd takes only its food: snapshots and the
## bootstrap place the snakes).
signal world_keyframe(snapshot: Dictionary)
signal player_joined(meta: Dictionary)
signal player_left(id: String)
signal player_died(death: Dictionary)
signal leaderboard_updated(entries: Array)
## The party ended: its host closed it ("closed") or left ("hostLeft"), or
## joining it found it ended ("ended").
signal party_ended(reason: String)

var world_id := ""
var chat_id := ""
var my_id := ""
var bounds := Vector2(2400, 2400)
var is_in_world := false
## The party's app room, "" in the world: the party's feeds and input go to
## its host, the room's.
var party_room := ""

## Unpacks the world stream (snapshot_decoder.gd): its snapshots name the
## players by the stream's id table, which the seed and each snapshot
## introduce. Another server's world has another table.
var _decoder := SnapshotDecoder.new()

## ── World clock — shared server-timeline estimate ─────────────────────────
## Port of the bench harness's WorldClock (apps/api/src/bench/bot/
## world-clock.ts): anchors on a rolling min of (arrival − send) using the
## snapshot's `t` stamp, free-runs on the local clock between snapshots,
## slew-limited corrections. Replaces remote_snake.gd's per-entity
## estimators; falls back to a frame-rate-independent nudge when the server
## sends no timestamp. Remotes render on a timeline of their own behind it
## (the playback delay, below). Keep the two implementations in lockstep.

const CLOCK_TAU_S := 0.3
const CLOCK_WINDOW_S := 4.0
const CLOCK_MAX_SLEW_TICKS_PER_S := 2.0

## The server whose world the clock follows (its hello's `serverId`). Every
## hello anchors the clock again on the next snapshot; one from another
## server (a restarted one: a new world, ticks from 0) also forgets what the
## playback delay learned of the link, which a network blip keeps.
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

## ── Playback delay — how far behind the clock remotes render ──────────────
## Port of apps/api/src/bench/bot/playback-delay.ts (HYPOTHESES.md #3; keep
## the two in lockstep): exponentially weighted means (k = 2/201, about 10 s
## of arrivals) of the time between snapshot arrivals, of its variance, and
## of the frame time. The target delay is mean + 3σ + a frame, in ticks,
## clamped to [1.5, 6]. The render clock runs 5% fast or slow to reach it
## (outside a 5 ms dead band), never jumps to it (only the lag cap moves it
## at once, as snapshots resume after a stall longer than about 0.7 s), and
## runs at most 2 ticks past the newest tick seen (remote_snake.gd's
## extrapolation budget): a stall holds it there, and the delay that grew
## shrinks back at the warp's pace, from at most twice the ceiling behind (a
## longer stall resumes there). A gap counts as the ceiling at most, and a
## frame as 250 ms. An arrival here is the frame that polled it, so the gaps
## carry up to a frame of polling the bots' do not: Godot renders a little
## further behind than they do for the same link.

const PLAYBACK_MIN_TICKS := 1.5
const PLAYBACK_MAX_TICKS := 6.0
const PLAYBACK_START_TICKS := 2.5
const PLAYBACK_WARP := 0.05
const PLAYBACK_EWMA_K := 2.0 / 201.0
const PLAYBACK_SIGMAS := 3.0
const PLAYBACK_DEAD_BAND_MS := 5.0
## Twice the ceiling: the most the render clock lags the estimate once
## snapshots arrive (through a stall, the bound past the newest tick holds it)
const PLAYBACK_MAX_LAG_TICKS := 12.0
## remote_snake.gd's MAX_EXTRAPOLATION_TICKS: how far past the newest tick it runs
const PLAYBACK_MAX_AHEAD_TICKS := 2.0
const PLAYBACK_MAX_FRAME_MS := 250.0

## Times in ms, as floats (64-bit; never a Vector2, whose float32 quantizes them)
var _pb_last_arrival_ms := -1.0
var _pb_mean_ms := 0.0
var _pb_var_ms2 := 0.0
var _pb_arrivals := 0
var _pb_frame_ms := -1.0
var _render_tick := 0.0
var _has_render := false


func clock_observe(tick: int, send_t: float) -> void:
	_clock_latest = maxf(_clock_latest, float(tick))
	if not _clock_has_est:
		_clock_est = float(tick)
		_clock_has_est = true
	_playback_observe(float(Time.get_ticks_usec()) / 1000.0)
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
## start over, so the clock forgets everything. The same server's (a
## reconnect) keeps what the playback delay learned of the link, but not the
## outage as a gap, and the timeline anchors again on the next snapshot (see
## world-clock.ts followServer).
func clock_follow_server(server_id: String) -> void:
	if server_id != _clock_server_id:
		_clock_server_id = server_id
		_clock_forget_timeline()
		_playback_reset()
	else:
		_pb_last_arrival_ms = -1.0
		_clock_forget_timeline()


## Forgets the timeline: the next snapshot anchors it again.
func _clock_forget_timeline() -> void:
	_clock_est = 0.0
	_clock_latest = 0.0
	_clock_has_est = false
	_clock_arrivals.clear()
	_clock_delays.clear()
	_clock_last_tick = 0.0
	_clock_last_send_t = 0.0
	_clock_has_timestamps = false
	_render_tick = 0.0
	_has_render = false


## Forgets the arrivals and frames (another server's world).
func _playback_reset() -> void:
	_pb_last_arrival_ms = -1.0
	_pb_mean_ms = 0.0
	_pb_var_ms2 = 0.0
	_pb_arrivals = 0
	_pb_frame_ms = -1.0


## The render timeline first: its rate follows the delay as it stood between
## frames, the one remotes were drawn with.
func _process(delta: float) -> void:
	if not _clock_has_est:
		return
	_advance_render(delta)
	_advance_estimate(delta)


func _advance_estimate(delta: float) -> void:
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


## Runs the render clock toward the playback delay's target, at most
## PLAYBACK_MAX_LAG_TICKS behind the estimate and PLAYBACK_MAX_AHEAD_TICKS
## past the newest tick. The second bound wins: through a long stall the
## render clock holds, and the lag cap moves it on (a jump) once snapshots
## arrive again.
func _advance_render(delta: float) -> void:
	if _has_render:
		_playback_frame(delta * 1000.0)
		var rate := _playback_rate(_clock_est - _render_tick)
		_render_tick += delta * GameConfig.TICK_RATE * rate
	else:
		_render_tick = _clock_est - PLAYBACK_START_TICKS
		_has_render = true
	_render_tick = minf(
		maxf(_render_tick, _clock_est - PLAYBACK_MAX_LAG_TICKS),
		_clock_latest + PLAYBACK_MAX_AHEAD_TICKS
	)


## A snapshot arrived (ms on a clock that only moves forward).
func _playback_observe(arrival_ms: float) -> void:
	var last := _pb_last_arrival_ms
	_pb_last_arrival_ms = arrival_ms
	if last < 0.0:
		return
	var gap := minf(arrival_ms - last, PLAYBACK_MAX_TICKS * 1000.0 / GameConfig.TICK_RATE)
	if _pb_arrivals == 0:
		_pb_mean_ms = gap
	else:
		# The incremental exponentially weighted mean and variance
		var diff := gap - _pb_mean_ms
		var incr := PLAYBACK_EWMA_K * diff
		_pb_mean_ms += incr
		_pb_var_ms2 = (1.0 - PLAYBACK_EWMA_K) * (_pb_var_ms2 + diff * incr)
	_pb_arrivals += 1


## A render frame of `frame_ms` passed.
func _playback_frame(frame_ms: float) -> void:
	var sample := minf(frame_ms, PLAYBACK_MAX_FRAME_MS)
	if _pb_frame_ms < 0.0:
		_pb_frame_ms = sample
	else:
		_pb_frame_ms += PLAYBACK_EWMA_K * (sample - _pb_frame_ms)


## The delay to converge on, in ticks.
func _playback_target_ticks() -> float:
	if _pb_arrivals == 0:
		return PLAYBACK_START_TICKS
	var ms := _pb_mean_ms + PLAYBACK_SIGMAS * sqrt(_pb_var_ms2) + maxf(_pb_frame_ms, 0.0)
	return clampf(ms * GameConfig.TICK_RATE / 1000.0, PLAYBACK_MIN_TICKS, PLAYBACK_MAX_TICKS)


## The render clock's rate for a delay of `delay_ticks` now: faster to
## shorten it, slower to lengthen it, 1 within the dead band.
func _playback_rate(delay_ticks: float) -> float:
	var error_ms := (delay_ticks - _playback_target_ticks()) * 1000.0 / GameConfig.TICK_RATE
	if error_ms > PLAYBACK_DEAD_BAND_MS:
		return 1.0 + PLAYBACK_WARP
	if error_ms < -PLAYBACK_DEAD_BAND_MS:
		return 1.0 - PLAYBACK_WARP
	return 1.0


func has_render_tick() -> bool:
	return _clock_has_est


## The tick remotes render at: the render timeline.
func render_tick() -> float:
	return _render_tick if _has_render else _clock_est - PLAYBACK_START_TICKS


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
	if Net.client.server_id != _clock_server_id:
		_decoder.reset()
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
	if not Net.party_code.is_empty():
		# a party's host runs the default tunables (PARTY_TUNABLES): no definition
		await _enter_party_once()
		return
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


## A party: joinParty puts this socket in the party's room and names its
## host. Its bootstrap holds no world, so it goes out first (main.gd clears
## the world with it); the party's feeds then come from the host, their
## seeds with the names (partyEvents first) and every snake and all the food
## (partyWorld). A party that ended answers NOT_FOUND: no retry then.
func _enter_party_once() -> void:
	var entry: Dictionary = await Net.client.call_method(
		"gameService", "joinParty", {"code": Net.party_code}
	)
	if not entry.get("ok", false):
		var error: Variant = entry.get("e")
		if error is Dictionary and (error as Dictionary).get("code") == "NOT_FOUND":
			party_ended.emit("ended")
		else:
			join_failed.emit(_error_of(entry, "Failed to join the party"))
		return

	var bootstrap := entry["d"] as Dictionary
	world_id = str(bootstrap["worldId"])
	party_room = "party:" + world_id
	chat_id = str(bootstrap.get("chatId", ""))
	var b := bootstrap["bounds"] as Dictionary
	bounds = Vector2(float(b["w"]), float(b["h"]))
	is_in_world = true
	world_ready.emit(bootstrap)

	# Held feeds: the client subscribes again by itself each time a link to
	# the room's host opens (a reconnect)
	for stream in ["partyEvents", "partyWorld"]:
		if Net.client.is_subscribed("gameService", stream, world_id, party_room):
			continue
		var sub: Dictionary = await Net.client.subscribe_stream(
			"gameService", stream, world_id, party_room
		)
		if not sub.get("ok", false):
			join_failed.emit(_error_of(sub, "The party's host sent no %s" % stream))
			return

	# Editor/desktop and check:godot play at once; on the web the page's dialog does
	if Net.auto_spawn:
		await Net.client.call_method("gameService", "playParty", {"worldId": world_id})
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


## A snapshot pushed to the world stream (`qd:stream`, 20Hz, volatile),
## packed; or a party's, raw, or its event, from the party's host.
func _on_stream_item(service: String, stream: String, _scope: String, item: Variant) -> void:
	if service != "gameService" or not item is Dictionary:
		return
	var snapshot: Dictionary
	match stream:
		"world":
			snapshot = _decoder.decode(str((item as Dictionary).get("b", "")))
		"partyWorld":
			snapshot = item as Dictionary
		"partyEvents":
			_on_party_event(item as Dictionary)
			return
		_:
			return
	if snapshot.is_empty():
		return
	clock_observe(int(snapshot.get("tick", 0)), float(snapshot.get("t", 0.0)))
	if Bench.enabled:
		Bench.on_snapshot(int(snapshot.get("tick", 0)))
	snapshot_received.emit(snapshot)


## The world stream's seed, on subscribing, after every reconnect and on a
## resync (resync_world): the world now (every snake, all the food), which
## the snapshots that follow change. It can be handled after snapshots newer
## than it (the client hands a reply over on the next frame, stream items at
## once), so it goes out as a keyframe, never as a snapshot. Not a tick's
## arrival (it carries no send time), so the clock skips it.
func _on_stream_seeded(service: String, stream: String, _scope: String, seed: Array) -> void:
	if service != "gameService" or not stream in ["world", "partyWorld", "partyEvents"]:
		return
	for item in seed:
		if not item is Dictionary:
			continue
		if stream == "partyEvents":
			_on_party_event(item as Dictionary)
			continue
		var keyframe: Dictionary = (
			item as Dictionary
			if stream == "partyWorld"
			else _decoder.decode(str((item as Dictionary).get("b", "")))
		)
		if not keyframe.is_empty():
			world_keyframe.emit(keyframe)


## One of a party's events, from its host: what the world's events are to
## the server's world (its seed has a `joined` for every player).
func _on_party_event(event: Dictionary) -> void:
	match str(event.get("kind", "")):
		"joined":
			player_joined.emit(event)
		"left":
			player_left.emit(str(event.get("id", "")))
		"death":
			player_died.emit(event)
		"leaderboard":
			leaderboard_updated.emit(event.get("entries", []) as Array)


## A snapshot named a player by an introduction this client missed (it lost
## more snapshots than they repeat it in): a keyframe names them all again.
func world_needs_keyframe() -> bool:
	# a party's snapshots name their players inline
	return party_room.is_empty() and _decoder.needs_keyframe()


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
	# A party's end, from the server, to its room
	Net.client.on_event("gameService", "partyClosed", func(ended: Variant) -> void:
		_on_party_end(ended, "closed"))
	Net.client.on_event("gameService", "hostLeft", func(ended: Variant) -> void:
		_on_party_end(ended, "hostLeft"))


func _on_party_end(ended: Variant, reason: String) -> void:
	if ended is Dictionary and str((ended as Dictionary).get("worldId", "")) == world_id:
		is_in_world = false
		party_ended.emit(reason)


## One message on the input channel: the newest frame last, with up to three
## unacknowledged ones before it (local_snake.gd keeps them).
func send_inputs(frames: Array) -> void:
	if not is_in_world or frames.is_empty():
		return
	if Bench.enabled:
		Bench.on_input(int(frames[-1]["seq"]))
	# `qd:ch`: fire and forget, never acknowledged; the server drops it unless
	# this socket is in the world's room. A party's goes to its host, on the
	# link's fast channel
	if party_room.is_empty():
		Net.client.send_channel("gameService", "input", {"frames": frames})
	else:
		Net.client.send_channel("gameService", "partyInput", {"frames": frames}, party_room)


## Missed more snapshots than the food window repeats: subscribe to the
## world stream again. Its seed goes out as world_keyframe before this
## returns. False when the server refused it or no answer came (a timeout, a
## disconnect).
func resync_world() -> bool:
	if world_id.is_empty():
		return false
	var stream := "world" if party_room.is_empty() else "partyWorld"
	var sub: Dictionary = await Net.client.subscribe_stream(
		"gameService", stream, world_id, party_room
	)
	return sub.get("ok", false)


## Commands stay quickdraw methods — the same call a React button makes.
func respawn() -> void:
	if world_id.is_empty():
		return
	# a party's host respawns the snake on the server's word (partyPlayer)
	var method := "respawn" if party_room.is_empty() else "playParty"
	await Net.client.call_method("gameService", method, {"worldId": world_id})
