extends SceneTree
## The headless two-client check (`bun run check:godot`, driven by
## apps/api/src/bench/godot-session.ts): runs the real game — the main scene
## and its autoloads (Net, Game, Bench) — against the server the driver
## started, steers the local snake toward the world's centre so two clients'
## snakes meet, respawns after a death, and prints what it sees as
## `PROBE <json>` lines for the driver to check:
##
##   connected      a hello (again after every reconnect): who the socket is
##   world          a bootstrap landed (joinGame): the players in it
##   seen           every 0.5 s: the local snake and the others, from the
##                  latest snapshot of the world stream, and where the
##                  others are drawn (their RemoteSnake, interpolated on the
##                  world clock) and the clock's render tick
##   food           every 0.5 s: the food main.gd holds (its FoodLayer's ids),
##                  the tick whose changes it holds, and the keyframes it
##                  asked for after a gap
##   blackout       with QD_FOOD_BLACKOUT=1: main.gd hears no snapshot for
##                  BLACKOUT_FOR_S (start, end), once, BLACKOUT_AFTER_S after
##                  the first bootstrap, as if the stream dropped them
##   death, leaderboard, left   the world's events (a party's, from its host)
##   party_ended    a party's end: its host closed it or left ("reason")
##   disconnected, refused      the connection
##
## Env: QUICKDRAW_DEV_USER_ID and QUICKDRAW_API_URL (read by net.gd),
## QUICKDRAW_PARTY_CODE (net.gd: a party instead of the world, over the
## relay to its host), QD_SESSION_SECONDS (default 90), after which it quits
## on its own, and QD_FOOD_BLACKOUT.
##
## The game's scripts name the autoloads (Game, Net) as globals, which a
## --script main loop compiles before they exist: this script refers to them
## and to the game's classes only at run time, by node and by property.

const PROBE_EVERY_S := 0.5
const RESPAWN_AFTER_S := 1.0
const BLACKOUT_AFTER_S := 4.0
## 20 ticks: more than the food window, so main.gd must ask for a keyframe
const BLACKOUT_FOR_S := 1.0

var _main: Node
var _game: Node
var _net: Node
var _latest: Dictionary = {}
var _since_probe := 0.0
var _elapsed := 0.0
var _limit_s := 90.0
var _respawn_in := -1.0
var _wired := false
## Seconds until the blackout starts (then ends), counted from the first
## bootstrap; whether it is planned (once) and on
var _blackout_in := -1.0
var _blackout_planned := false
var _blacked_out := false


func _initialize() -> void:
	var limit := OS.get_environment("QD_SESSION_SECONDS")
	if limit.is_valid_float():
		_limit_s = float(limit)
	_net = root.get_node("Net")
	_game = root.get_node("Game")
	_main = (load("res://scenes/main.tscn") as PackedScene).instantiate()
	root.add_child(_main)


## Once the autoloads are ready (Net made its client): listen to everything.
func _wire() -> void:
	_wired = true
	var client: Node = _net.get("client")
	client.connect("connected", func(hello: Dictionary) -> void:
		_probe({"kind": "connected", "userId": hello.get("userId")}))
	client.connect("disconnected", func(reason: String) -> void:
		_probe({"kind": "disconnected", "reason": reason}))
	client.connect("refused", func(code: String, message: String) -> void:
		_probe({"kind": "refused", "code": code, "message": message}))
	_game.connect("world_ready", func(bootstrap: Dictionary) -> void:
		if OS.get_environment("QD_FOOD_BLACKOUT") == "1" and not _blackout_planned:
			_blackout_planned = true
			_blackout_in = BLACKOUT_AFTER_S
		var ids: Array = []
		for meta in bootstrap.get("players", []):
			ids.append((meta as Dictionary).get("id"))
		_probe({"kind": "world", "tick": bootstrap.get("tick"), "players": ids}))
	_game.connect("snapshot_received", func(snapshot: Dictionary) -> void:
		_latest = snapshot)
	_game.connect("player_died", _on_death)
	_game.connect("leaderboard_updated", func(entries: Array) -> void:
		var ids: Array = []
		for entry in entries:
			ids.append((entry as Dictionary).get("id"))
		_probe({"kind": "leaderboard", "ids": ids}))
	_game.connect("player_left", func(id: String) -> void:
		_probe({"kind": "left", "id": id}))
	_game.connect("party_ended", func(reason: String) -> void:
		_probe({"kind": "party_ended", "reason": reason}))


func _process(delta: float) -> bool:
	if not _wired and _net.get("client") != null:
		_wire()
	_elapsed += delta
	if _elapsed > _limit_s:
		_probe({"kind": "timeout"})
		return true

	# No mouse headless: steer the local snake (LocalSnake) to the world's centre
	var local: Variant = _main.get("_local")
	if local is Node and is_instance_valid(local):
		(local as Node).set("steer_target", (_game.get("bounds") as Vector2) / 2.0)

	if _respawn_in > 0.0:
		_respawn_in -= delta
		if _respawn_in <= 0.0:
			_game.call("respawn")

	if _blackout_in > 0.0:
		_blackout_in -= delta
		if _blackout_in <= 0.0:
			_toggle_blackout()

	_since_probe += delta
	if _since_probe >= PROBE_EVERY_S and not _latest.is_empty():
		_since_probe = 0.0
		_probe_seen()
		_probe_food()
	return false


func _on_death(death: Dictionary) -> void:
	_probe({"kind": "death", "id": death.get("id"), "len": death.get("len")})
	if str(death.get("id")) == str(_game.get("my_id")):
		_respawn_in = RESPAWN_AFTER_S


## The local snake and every other player, as the latest snapshot places
## them, and where main.gd draws the others.
func _probe_seen() -> void:
	var me: Variant = null
	var others := {}
	var my_id := str(_game.get("my_id"))
	for raw in _latest.get("players", []):
		var snap := raw as Dictionary
		var at := [snappedf(float(snap["x"]), 0.1), snappedf(float(snap["y"]), 0.1)]
		if str(snap["id"]) == my_id:
			me = at
		else:
			others[str(snap["id"])] = at
	var drawn := {}
	var remotes: Dictionary = _main.get("_remotes")
	for id in remotes:
		var node := remotes[id] as Node2D
		if is_instance_valid(node):
			drawn[str(id)] = [snappedf(node.position.x, 0.1), snappedf(node.position.y, 0.1)]
	var render_tick: Variant = _game.call("render_tick") if _game.call("has_render_tick") else null
	_probe({
		"kind": "seen",
		"tick": _latest.get("tick"),
		"renderTick": render_tick,
		"me": me,
		"others": others,
		"drawn": drawn,
	})


## The food main.gd holds, and the tick whose changes it holds (every one
## before it too), for the driver to check against the server's.
func _probe_food() -> void:
	var layer: Variant = _main.get("_food")
	if not (layer is Node):
		return
	var ids: Array = ((layer as Node).get("_food") as Dictionary).keys()
	_probe({
		"kind": "food",
		"tick": _main.get("_food_tick"),
		"ids": ids,
		"resyncs": _main.get("_food_resyncs"),
	})


## Starts the blackout (main.gd stops hearing snapshots), then ends it.
func _toggle_blackout() -> void:
	var handler := Callable(_main, "_on_snapshot")
	_blacked_out = not _blacked_out
	if _blacked_out:
		_game.disconnect("snapshot_received", handler)
		_blackout_in = BLACKOUT_FOR_S
	else:
		_game.connect("snapshot_received", handler)
	_probe({
		"kind": "blackout",
		"phase": "start" if _blacked_out else "end",
		"tick": _latest.get("tick"),
	})


func _probe(payload: Dictionary) -> void:
	payload["t"] = Time.get_ticks_msec()
	print("PROBE ", JSON.stringify(payload))
