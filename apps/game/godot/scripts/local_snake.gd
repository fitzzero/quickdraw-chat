class_name LocalSnake
extends SnakeBody
## The local player: client-side prediction + server reconciliation.
##
## Every fixed step (at the server tick rate) we sample input, send it on the
## input channel, and immediately run the SAME movement rules as the server
## (GameConfig.sim_step). When a snapshot arrives we drop inputs the server
## has acknowledged (PlayerSnap.ack), re-simulate the unacknowledged rest
## from the authoritative state, and fold any difference into a decaying
## visual offset — corrections are invisible instead of rubber-bandy.

const HARD_SNAP_DIST := 64.0
const CORRECTION_HALF_LIFE := 0.08

var seq := 0
var sim_pos := Vector2.ZERO
var sim_dir := Vector2.RIGHT
var sim_len := float(GameConfig.START_LENGTH)

var _pending: Array[Dictionary] = []
var _accum := 0.0
var _visual_offset := Vector2.ZERO


func init_from_snap(snap: Dictionary) -> void:
	sim_pos = Vector2(float(snap["x"]), float(snap["y"]))
	sim_dir = Vector2(float(snap["dx"]), float(snap["dy"])).normalized()
	sim_len = float(snap["len"])
	length = sim_len
	seq = int(snap.get("ack", 0))
	position = sim_pos
	reset_path(sim_pos)


func _physics_process(delta: float) -> void:
	if not Game.is_joined:
		return

	_accum += delta
	while _accum >= GameConfig.FIXED_DT:
		_accum -= GameConfig.FIXED_DT
		_step_once()

	# Render: predicted position plus the decaying correction offset
	var decay := pow(0.5, delta / CORRECTION_HALF_LIFE)
	_visual_offset *= decay
	position = sim_pos + _visual_offset
	boosting = _is_boosting() and sim_len > GameConfig.MIN_LENGTH
	length = sim_len
	advance_path(position)


func _step_once() -> void:
	var aim := get_global_mouse_position() - position
	if aim.length() < 4.0:
		aim = sim_dir
	aim = aim.normalized()
	var boost := _is_boosting()

	seq += 1
	var frame := {"seq": seq, "dx": aim.x, "dy": aim.y, "boost": boost}
	_pending.append(frame)
	Game.send_input(seq, aim, boost)

	var next: Dictionary = GameConfig.sim_step(sim_pos, sim_dir, aim, boost, sim_len, Game.bounds)
	sim_pos = next["pos"]
	sim_dir = next["dir"]
	sim_len = next["len"]


func _is_boosting() -> bool:
	return (
		Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
		or Input.is_key_pressed(KEY_SPACE)
	)


## Reconciliation against the authoritative snapshot for this player.
func on_server_snap(snap: Dictionary) -> void:
	var ack := int(snap.get("ack", 0))
	while not _pending.is_empty() and int(_pending[0]["seq"]) <= ack:
		_pending.pop_front()

	# Replay unacknowledged inputs from the authoritative state
	var rp := Vector2(float(snap["x"]), float(snap["y"]))
	var rd := Vector2(float(snap["dx"]), float(snap["dy"])).normalized()
	var rl := float(snap["len"])
	for frame in _pending:
		var target := Vector2(float(frame["dx"]), float(frame["dy"]))
		var r: Dictionary = GameConfig.sim_step(rp, rd, target, bool(frame["boost"]), rl, Game.bounds)
		rp = r["pos"]
		rd = r["dir"]
		rl = r["len"]

	var error: Vector2 = rp - sim_pos
	if error.length() > HARD_SNAP_DIST:
		# Lag spike or respawn: teleport rather than smear across the world
		sim_pos = rp
		sim_dir = rd
		_visual_offset = Vector2.ZERO
		position = sim_pos
		reset_path(sim_pos)
	else:
		# Adopt the corrected state; keep what the player SEES continuous
		_visual_offset += sim_pos - rp
		sim_pos = rp
		sim_dir = rd
	# Length is server-authoritative (growth comes from server-side eating)
	sim_len = rl
