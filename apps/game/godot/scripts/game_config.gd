class_name GameConfig
extends RefCounted
## Movement tunables — MUST mirror DEFAULT_TUNABLES in
## apps/api/src/services/game/world.ts. The client runs the same movement
## rules as the server for prediction; if these drift, the local player will
## constantly reconcile.
##
## Phase 4 (DefinitionService) replaces these constants with values fetched
## from the server at load, giving one source of truth.

const TICK_RATE := 20.0
const FIXED_DT := 1.0 / TICK_RATE

const BASE_SPEED := 180.0
const BOOST_SPEED := 320.0
const TURN_RATE := 4.0
const START_LENGTH := 10
const MIN_LENGTH := 5.0
const BOOST_BURN_PER_SECOND := 1.5
const SEGMENT_SPACING := 16.0
const SAMPLE_SPACING := 8.0
const HEAD_RADIUS := 10.0
const BODY_RADIUS := 9.0
const FOOD_RADIUS := 14.0


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
	var max_turn := TURN_RATE * FIXED_DT
	var angle := current + clampf(delta, -max_turn, max_turn)
	var new_dir := Vector2(cos(angle), sin(angle))

	var boosting := boost and length > MIN_LENGTH
	var new_len := length
	if boosting:
		new_len = maxf(MIN_LENGTH, length - BOOST_BURN_PER_SECOND * FIXED_DT)
	var speed := BOOST_SPEED if boosting else BASE_SPEED

	var new_pos := pos + new_dir * speed * FIXED_DT
	new_pos.x = clampf(new_pos.x, HEAD_RADIUS, bounds.x - HEAD_RADIUS)
	new_pos.y = clampf(new_pos.y, HEAD_RADIUS, bounds.y - HEAD_RADIUS)

	return {"pos": new_pos, "dir": new_dir, "len": new_len}
