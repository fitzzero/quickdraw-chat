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
##   death, leaderboard, left   the world's events
##   disconnected, refused      the connection
##
## Env: QUICKDRAW_DEV_USER_ID and QUICKDRAW_API_URL (read by net.gd), and
## QD_SESSION_SECONDS (default 90), after which it quits on its own.
##
## The game's scripts name the autoloads (Game, Net) as globals, which a
## --script main loop compiles before they exist: this script refers to them
## and to the game's classes only at run time, by node and by property.

const PROBE_EVERY_S := 0.5
const RESPAWN_AFTER_S := 1.0

var _main: Node
var _game: Node
var _net: Node
var _latest: Dictionary = {}
var _since_probe := 0.0
var _elapsed := 0.0
var _limit_s := 90.0
var _respawn_in := -1.0
var _wired := false


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

	_since_probe += delta
	if _since_probe >= PROBE_EVERY_S and not _latest.is_empty():
		_since_probe = 0.0
		_probe_seen()
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


func _probe(payload: Dictionary) -> void:
	payload["t"] = Time.get_ticks_msec()
	print("PROBE ", JSON.stringify(payload))
