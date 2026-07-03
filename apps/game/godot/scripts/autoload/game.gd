extends Node
## Game (autoload) — join flow and world-state fan-out.
##
## Client ordering contract (see .claude/rules/game-patterns.md):
##   subscribe("gameService", worldId)  → room membership (gates everything)
##   joinGame                            → bootstrap state
##   channel input / snapshot events     → gameplay
##
## Commands stay quickdraw methods — respawn() below is the same call a
## React button would make.

signal joined(bootstrap: Dictionary)
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
var is_joined := false


func _ready() -> void:
	Net.ready_to_join.connect(_on_ready_to_join)
	if Net.client != null:
		Net.client.disconnected.connect(_on_disconnected)


func _on_ready_to_join() -> void:
	_join()


func _on_disconnected() -> void:
	is_joined = false


func _join() -> void:
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
		join_failed.emit(str(sub.get("error", "Subscribe failed")))
		return

	_wire_events()

	var join: Dictionary = await Net.client.call_method(
		"gameService", "joinGame", {"worldId": world_id}
	)
	if not join.get("success", false):
		join_failed.emit(str(join.get("error", "Join failed")))
		return

	var bootstrap := join["data"] as Dictionary
	my_id = str((bootstrap["you"] as Dictionary)["id"])
	chat_id = str(bootstrap.get("chatId", ""))
	var b := bootstrap["bounds"] as Dictionary
	bounds = Vector2(float(b["w"]), float(b["h"]))
	is_joined = true

	joined.emit(bootstrap)
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
	if not is_joined:
		return
	Net.client.send_channel("gameService", "input", {
		"seq": seq,
		"dx": dir.x,
		"dy": dir.y,
		"boost": boost,
	})


func respawn() -> void:
	if world_id.is_empty():
		return
	await Net.client.call_method("gameService", "respawn", {"worldId": world_id})
