class_name RemoteSnake
extends SnakeBody
## Remote players: snapshot-buffer interpolation.
##
## We render ~2.5 ticks (~125ms) in the past and interpolate between the two
## snapshots that bracket the render time. This is the standard fix for the
## lerp-to-latest rubber-banding: as long as the buffer holds two snapshots,
## motion is exactly as smooth as the sender's, just slightly delayed.
## On buffer underrun we extrapolate along the last known velocity for at
## most 2 ticks, then freeze.

const INTERP_DELAY_TICKS := 2.5
const MAX_EXTRAPOLATION_TICKS := 2.0
const BUFFER_LIMIT := 40

var last_seen_tick := 0

var _buffer: Array[Dictionary] = []
var _tick_est := 0.0
var _has_est := false


func push_snap(tick: int, snap: Dictionary) -> void:
	last_seen_tick = tick
	_buffer.append({
		"tick": float(tick),
		"pos": Vector2(float(snap["x"]), float(snap["y"])),
		"dir": Vector2(float(snap["dx"]), float(snap["dy"])),
		"len": float(snap["len"]),
		"boost": bool(snap.get("boost", false)),
	})
	while _buffer.size() > BUFFER_LIMIT:
		_buffer.pop_front()

	if not _has_est:
		_tick_est = float(tick)
		_has_est = true


func _process(delta: float) -> void:
	if _buffer.is_empty() or not _has_est:
		return

	# Advance the server-clock estimate by wall time, gently nudged toward
	# the freshest snapshot so drift never accumulates.
	var latest: float = _buffer[_buffer.size() - 1]["tick"]
	_tick_est += delta * GameConfig.TICK_RATE
	_tick_est += (latest - _tick_est) * 0.05

	var render_tick := _tick_est - INTERP_DELAY_TICKS
	_render_at(render_tick)
	advance_path(position)


func _render_at(render_tick: float) -> void:
	var before: Dictionary = _buffer[0]
	var after := {}

	for snap in _buffer:
		if float(snap["tick"]) <= render_tick:
			before = snap
		else:
			after = snap
			break

	if after.is_empty():
		# Underrun: extrapolate along last velocity, capped, then freeze
		var over := minf(render_tick - float(before["tick"]), MAX_EXTRAPOLATION_TICKS)
		var speed := GameConfig.boost_speed if bool(before["boost"]) else GameConfig.base_speed
		position = (before["pos"] as Vector2) + (before["dir"] as Vector2) * speed * GameConfig.FIXED_DT * over
		length = float(before["len"])
		boosting = bool(before["boost"])
		return

	var t0 := float(before["tick"])
	var t1 := float(after["tick"])
	var t := clampf((render_tick - t0) / maxf(t1 - t0, 0.001), 0.0, 1.0)
	position = (before["pos"] as Vector2).lerp(after["pos"] as Vector2, t)
	length = lerpf(float(before["len"]), float(after["len"]), t)
	boosting = bool(after["boost"])
