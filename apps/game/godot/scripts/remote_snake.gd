class_name RemoteSnake
extends SnakeBody
## Remote players: snapshot-buffer interpolation on the SHARED world clock.
##
## The render timeline comes from Game's world clock (timestamp-synced, one
## per client — see game.gd) instead of a per-entity estimator, so every
## remote renders the same moment of the world. We render
## INTERP_DELAY_TICKS in the past and interpolate between the bracketing
## snapshots. On buffer underrun (late/stalled snapshots) we extrapolate
## along the last velocity, then COAST to a stop instead of freezing; when
## data resumes, the target jump is folded into a fast-decaying glide offset
## so the snake slides back onto its true path instead of teleporting.
## Mirrors the bench bots' interpolation.ts — keep in lockstep.

const MAX_EXTRAPOLATION_TICKS := 2.0
const SOFT_STOP_TICKS := 3.0
const BUFFER_LIMIT := 40
const GLIDE_HALF_LIFE := 0.1
const MAX_GLIDE_PX := 200.0

var last_seen_tick := 0

var _buffer: Array[Dictionary] = []
var _has_prev_target := false
var _prev_target := Vector2.ZERO
var _glide := Vector2.ZERO


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


func _process(delta: float) -> void:
	if _buffer.is_empty() or not Game.has_render_tick():
		return

	var target := _render_at(Game.render_tick())

	# Fold target discontinuities (stall-recovery jumps) into the glide;
	# threshold scales with frame time so ordinary motion never triggers it.
	if _has_prev_target:
		var jump := target - _prev_target
		var plausible := 2.5 * GameConfig.boost_speed * maxf(delta, 1.0 / 250.0)
		if jump.length() > plausible and jump.length() < MAX_GLIDE_PX:
			_glide -= jump
		elif jump.length() >= MAX_GLIDE_PX:
			_glide = Vector2.ZERO
	_prev_target = target
	_has_prev_target = true

	_glide *= pow(0.5, delta / GLIDE_HALF_LIFE)
	position = target + _glide
	advance_path(position)


## Interpolated (or extrapolated) position at `render_tick`; also updates
## length/boost display state from the bracketing snapshots.
func _render_at(render_tick: float) -> Vector2:
	var before: Dictionary = _buffer[0]
	var after := {}

	for snap in _buffer:
		if float(snap["tick"]) <= render_tick:
			before = snap
		else:
			after = snap
			break

	if after.is_empty():
		# Underrun: linear extrapolation for the budget, then coast to a
		# stop over SOFT_STOP_TICKS (velocity ramps to zero — no hard freeze)
		var over := render_tick - float(before["tick"])
		var speed := GameConfig.boost_speed if bool(before["boost"]) else GameConfig.base_speed
		var distance_ticks: float
		if over <= MAX_EXTRAPOLATION_TICKS:
			distance_ticks = over
		else:
			var coast := minf(over - MAX_EXTRAPOLATION_TICKS, SOFT_STOP_TICKS)
			distance_ticks = (
				MAX_EXTRAPOLATION_TICKS + coast - (coast * coast) / (2.0 * SOFT_STOP_TICKS)
			)
		length = float(before["len"])
		boosting = bool(before["boost"])
		return (
			(before["pos"] as Vector2)
			+ (before["dir"] as Vector2) * speed * GameConfig.FIXED_DT * distance_ticks
		)

	var t0 := float(before["tick"])
	var t1 := float(after["tick"])
	var t := clampf((render_tick - t0) / maxf(t1 - t0, 0.001), 0.0, 1.0)
	length = lerpf(float(before["len"]), float(after["len"]), t)
	boosting = bool(after["boost"])
	return (before["pos"] as Vector2).lerp(after["pos"] as Vector2, t)
