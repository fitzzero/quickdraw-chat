class_name FoodLayer
extends Node2D
## Draws all food in one node (one draw pass instead of hundreds of nodes).
## Food arrives as a full list (the bootstrap, a keyframe), then as each
## tick's spawned/eaten changes, which every snapshot repeats for the last
## GameConfig.FOOD_WINDOW ticks (main.gd applies each tick's once).

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


## Applies the food changes of the entries after `after_tick`, in tick order.
func apply_deltas(entries: Array, after_tick: int) -> void:
	for raw in entries:
		var entry := raw as Dictionary
		if int(entry.get("tick", 0)) <= after_tick:
			continue
		for item in entry.get("spawned", []):
			add_item(item as Dictionary)
		for id in entry.get("eaten", []):
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
