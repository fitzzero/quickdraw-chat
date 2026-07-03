extends Node2D
## Main scene: builds the world from the entry bootstrap (spectate or join),
## routes snapshots to the right snake implementation (prediction for the
## local player, interpolation buffers for remotes). All player-facing UI
## (pre-game dialog, death screen, HUD, chat) lives in the web wrapper as
## DOM overlays; the local snake spawns whenever my_id appears in a snapshot.

const PRUNE_AFTER_TICKS := 60

var _local: LocalSnake
var _remotes: Dictionary = {}
var _food: FoodLayer
var _camera: Camera2D
var _world_layer: Node2D
var _status: Label
var _latest_tick := 0
var _player_meta: Dictionary = {}


func _ready() -> void:
	_build_scene()
	Game.world_ready.connect(_on_world_ready)
	Game.join_failed.connect(_on_join_failed)
	Game.snapshot_received.connect(_on_snapshot)
	Game.player_joined.connect(func(meta: Dictionary) -> void:
		_player_meta[str(meta["id"])] = meta)
	Game.player_left.connect(_on_player_left)
	Game.player_died.connect(_on_player_died)
	_set_status("Connecting…")


func _build_scene() -> void:
	_world_layer = Node2D.new()
	add_child(_world_layer)

	_food = FoodLayer.new()
	_world_layer.add_child(_food)

	_camera = Camera2D.new()
	_camera.position_smoothing_enabled = true
	_camera.position_smoothing_speed = 8.0
	add_child(_camera)
	_camera.make_current()

	# Stretch is disabled (native-resolution rendering); normalize apparent
	# world scale across window sizes with camera zoom instead.
	_update_camera_zoom()
	get_viewport().size_changed.connect(_update_camera_zoom)

	var ui := CanvasLayer.new()
	add_child(ui)

	_status = Label.new()
	_status.position = Vector2(12, 10)
	_status.add_theme_font_size_override("font_size", 13)
	_status.add_theme_color_override("font_color", Color(1, 1, 1, 0.7))
	ui.add_child(_status)


func _update_camera_zoom() -> void:
	var size := get_viewport_rect().size
	if size.y > 0:
		_camera.zoom = Vector2.ONE * (size.y / 720.0)


# =============================================================================
# Join / world lifecycle
# =============================================================================


func _on_world_ready(bootstrap: Dictionary) -> void:
	_set_status("")
	_clear_world()

	for meta in bootstrap.get("players", []):
		_player_meta[str((meta as Dictionary)["id"])] = meta

	_food.set_all(bootstrap.get("food", []))
	_latest_tick = int(bootstrap.get("tick", 0))

	for snap in bootstrap.get("snaps", []):
		_spawn_snake_from_snap(snap as Dictionary, _latest_tick)


func _on_join_failed(error: String) -> void:
	_set_status("Join failed: %s (retrying…)" % error)
	await get_tree().create_timer(3.0).timeout
	if not Game.is_in_world and Net.client.is_socket_connected():
		Game._enter_world()


func _clear_world() -> void:
	if _local != null:
		_local.queue_free()
		_local = null
	for snake: RemoteSnake in _remotes.values():
		snake.queue_free()
	_remotes.clear()


func _spawn_snake_from_snap(snap: Dictionary, tick: int) -> void:
	var id := str(snap["id"])
	var meta: Dictionary = _player_meta.get(id, {"hue": 0.0, "name": ""})
	var start := Vector2(float(snap["x"]), float(snap["y"]))
	var display := str(meta.get("name", "")) if meta.get("name") != null else ""

	if id == Game.my_id:
		_local = LocalSnake.new()
		_world_layer.add_child(_local)
		_local.setup(float(meta.get("hue", 0)), "", start)
		_local.init_from_snap(snap)
	else:
		var remote := RemoteSnake.new()
		_world_layer.add_child(remote)
		remote.setup(float(meta.get("hue", 0)), display, start)
		remote.push_snap(tick, snap)
		_remotes[id] = remote


# =============================================================================
# Snapshot routing
# =============================================================================


func _on_snapshot(snapshot: Dictionary) -> void:
	var tick := int(snapshot["tick"])
	_latest_tick = tick
	_food.apply_snapshot_deltas(snapshot)

	for raw in snapshot.get("players", []):
		var snap := raw as Dictionary
		var id := str(snap["id"])
		if id == Game.my_id:
			if _local == null:
				# (Re)spawned server-side (joinGame/respawn was called — possibly
				# by the React dialog) — build the local snake from this snap
				_spawn_snake_from_snap(snap, tick)
			else:
				_local.on_server_snap(snap)
		elif _remotes.has(id):
			(_remotes[id] as RemoteSnake).push_snap(tick, snap)
		else:
			_spawn_snake_from_snap(snap, tick)

	_prune_stale_remotes(tick)


## Reliable playerLeft/death events normally clean up remotes; the prune is a
## safety net for events missed across reconnects.
func _prune_stale_remotes(tick: int) -> void:
	for id in _remotes.keys():
		var snake := _remotes[id] as RemoteSnake
		if tick - snake.last_seen_tick > PRUNE_AFTER_TICKS:
			snake.queue_free()
			_remotes.erase(id)


func _on_player_left(id: String) -> void:
	if _remotes.has(id):
		(_remotes[id] as RemoteSnake).queue_free()
		_remotes.erase(id)


func _on_player_died(death: Dictionary) -> void:
	var id := str(death["id"])
	if id == Game.my_id:
		# The wrapper's dialog owns the death UI; keep rendering the world
		if _local != null:
			_local.queue_free()
			_local = null
	elif _remotes.has(id):
		(_remotes[id] as RemoteSnake).queue_free()
		_remotes.erase(id)


# =============================================================================
# Frame update
# =============================================================================


func _process(_delta: float) -> void:
	if _local != null:
		_camera.position = _local.position
	if not Net.client.is_socket_connected() and Game.is_in_world == false:
		_set_status("Reconnecting…")
	elif _status.text.begins_with("Reconnecting") and Net.client.is_socket_connected():
		_set_status("")
	queue_redraw()


func _draw() -> void:
	# World bounds
	draw_rect(Rect2(Vector2.ZERO, Game.bounds), Color(1, 1, 1, 0.15), false, 3.0)
	# Subtle grid for motion reference
	var cell := 120.0
	var grid := Color(1, 1, 1, 0.04)
	var x := 0.0
	while x <= Game.bounds.x:
		draw_line(Vector2(x, 0), Vector2(x, Game.bounds.y), grid, 1.0)
		x += cell
	var y := 0.0
	while y <= Game.bounds.y:
		draw_line(Vector2(0, y), Vector2(Game.bounds.x, y), grid, 1.0)
		y += cell


func _set_status(text: String) -> void:
	_status.text = text
