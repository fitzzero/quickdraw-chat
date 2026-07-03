class_name SnakeBody
extends Node2D
## Shared snake renderer. The node's `position` is the head; the body is
## DERIVED from a path history of head positions (same trick as the server —
## only heads exist on the wire). Segments are placed at fixed arc-length
## spacing walking backward along the path.

var hue := 0.0
var length := float(GameConfig.start_length)
var display_name := ""
var boosting := false

var _path: PackedVector2Array = PackedVector2Array()
var _name_label: Label


func setup(meta_hue: float, meta_name: String, start_pos: Vector2) -> void:
	hue = meta_hue
	display_name = meta_name
	position = start_pos
	_path = PackedVector2Array([start_pos])

	_name_label = Label.new()
	_name_label.text = display_name
	_name_label.add_theme_font_size_override("font_size", 12)
	_name_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.8))
	_name_label.position = Vector2(-30, -34)
	add_child(_name_label)


## Call every frame with the current head position (global).
func advance_path(head: Vector2) -> void:
	if _path.is_empty():
		_path.append(head)
		return
	var last := _path[_path.size() - 1]
	if head.distance_to(last) >= GameConfig.sample_spacing:
		_path.append(head)
		var max_samples := ceili(length * GameConfig.segment_spacing / GameConfig.sample_spacing) + 4
		while _path.size() > max_samples:
			_path.remove_at(0)
	queue_redraw()


func reset_path(head: Vector2) -> void:
	_path = PackedVector2Array([head])


func _draw() -> void:
	var body_color := Color.from_hsv(hue / 360.0, 0.7, 0.9)
	var glow := Color.from_hsv(hue / 360.0, 0.5, 1.0, 0.35)

	# Walk backward from the head, dropping a segment every SEGMENT_SPACING px
	var segments := int(length)
	var placed := 0
	var walk := 0.0
	var next_at := GameConfig.segment_spacing
	var prev := position

	for i in range(_path.size() - 1, -1, -1):
		if placed >= segments:
			break
		var sample := _path[i]
		var step := prev.distance_to(sample)
		while walk + step >= next_at and placed < segments:
			var t := (next_at - walk) / maxf(step, 0.001)
			var seg_pos := prev.lerp(sample, t)
			var r := GameConfig.body_radius * (1.0 - 0.3 * float(placed) / maxf(float(segments), 1.0))
			draw_circle(seg_pos - position, r + 3.0, glow)
			draw_circle(seg_pos - position, r, body_color.darkened(0.1 + 0.02 * (placed % 2)))
			placed += 1
			next_at += GameConfig.segment_spacing
		walk += step
		prev = sample

	# Head (drawn last, on top), with boost flare
	if boosting:
		draw_circle(Vector2.ZERO, GameConfig.head_radius + 6.0, Color(1, 1, 1, 0.25))
	draw_circle(Vector2.ZERO, GameConfig.head_radius + 3.0, glow)
	draw_circle(Vector2.ZERO, GameConfig.head_radius, body_color)
	draw_circle(Vector2(3, -3), 2.5, Color.WHITE)
	draw_circle(Vector2(3, 3), 2.5, Color.WHITE)
