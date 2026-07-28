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
			snapshot_received.emit(data as Dictionary))
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
