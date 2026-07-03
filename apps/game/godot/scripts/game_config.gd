class_name GameConfig
extends RefCounted
## Movement tunables. Defaults mirror DEFAULT_TUNABLES in
## apps/api/src/services/game/world.ts; the live values are fetched from
## DefinitionService at load (see game.gd → load_tunables), so the server
## sim and every client share one source of truth and balance edits in
## /admin/definitionService apply without re-exporting the game.
##
## The client runs the same movement rules as the server for prediction —
## if these drift from the server's, the local player constantly reconciles.

const TICK_RATE := 20.0
const FIXED_DT := 1.0 / TICK_RATE

static var base_speed := 180.0
static var boost_speed := 320.0
static var turn_rate := 4.0
static var start_length := 10.0
static var min_length := 5.0
static var boost_burn_per_second := 1.5
static var segment_spacing := 16.0
static var sample_spacing := 8.0
static var head_radius := 10.0
static var body_radius := 9.0
static var food_radius := 14.0

## Maps DefinitionService "tunables/snake" data keys → static vars.
static func apply_tunables(data: Dictionary) -> void:
	base_speed = _num(data, "baseSpeed", base_speed)
	boost_speed = _num(data, "boostSpeed", boost_speed)
	turn_rate = _num(data, "turnRate", turn_rate)
	start_length = _num(data, "startLength", start_length)
	min_length = _num(data, "minLength", min_length)
	boost_burn_per_second = _num(data, "boostBurnPerSecond", boost_burn_per_second)
	segment_spacing = _num(data, "segmentSpacing", segment_spacing)
	sample_spacing = _num(data, "sampleSpacing", sample_spacing)
	head_radius = _num(data, "headRadius", head_radius)
	body_radius = _num(data, "bodyRadius", body_radius)
	food_radius = _num(data, "foodRadius", food_radius)


static func _num(data: Dictionary, key: String, fallback: float) -> float:
	if data.has(key) and (data[key] is float or data[key] is int):
		var value := float(data[key])
		if value > 0.0 and is_finite(value):
			return value
	return fallback


## One shared movement step — identical math to GameWorldSim.moveSnake().
## Returns {"pos": Vector2, "dir": Vector2, "len": float}.
static func sim_step(
	pos: Vector2,
	dir: Vector2,
	target_dir: Vector2,
	boost: bool,
	length: float,
	bounds: Vector2,
) -> Dictionary:
	var current := dir.angle()
	var target := target_dir.angle()
	var delta := wrapf(target - current, -PI, PI)
	var max_turn := turn_rate * FIXED_DT
	var angle := current + clampf(delta, -max_turn, max_turn)
	var new_dir := Vector2(cos(angle), sin(angle))

	var boosting := boost and length > min_length
	var new_len := length
	if boosting:
		new_len = maxf(min_length, length - boost_burn_per_second * FIXED_DT)
	var speed := boost_speed if boosting else base_speed

	var new_pos := pos + new_dir * speed * FIXED_DT
	new_pos.x = clampf(new_pos.x, head_radius, bounds.x - head_radius)
	new_pos.y = clampf(new_pos.y, head_radius, bounds.y - head_radius)

	return {"pos": new_pos, "dir": new_dir, "len": new_len}
