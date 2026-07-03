class_name FoodLayer
extends Node2D
## Draws all food in one node (one draw pass instead of hundreds of nodes).
## Food arrives as a full list at bootstrap, then as spawned/eaten deltas in
## every snapshot.

var _food: Dictionary = {}
var _pulse := 0.0


func set_all(items: Array) -> void:
	_food.clear()
	for item in items:
		add_item(item as Dictionary)
	queue_redraw()


func add_item(item: Dictionary) -> void:
	_food[str(item["id"])] = item


func remove_item(id: String) -> void:
	_food.erase(id)


func apply_snapshot_deltas(snapshot: Dictionary) -> void:
	for item in snapshot.get("foodSpawned", []):
		add_item(item as Dictionary)
	for id in snapshot.get("foodEaten", []):
		remove_item(str(id))
	queue_redraw()


func _process(delta: float) -> void:
	_pulse += delta * 2.0
	queue_redraw()


func _draw() -> void:
	var wobble := 1.0 + 0.12 * sin(_pulse)
	for item: Dictionary in _food.values():
		var pos := Vector2(float(item["x"]), float(item["y"]))
		var value := float(item.get("v", 1))
		var r := (3.0 + value * 1.5) * wobble
		var hue := fmod(float(item["id"].hash() % 360), 360.0) / 360.0
		var color := Color.from_hsv(hue, 0.6, 1.0)
		draw_circle(pos, r + 2.0, Color(color, 0.25))
		draw_circle(pos, r, color)
