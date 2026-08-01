extends Node
## Bench (autoload) — netcode telemetry bridge for the benchmark harness.
##
## DORMANT by default: activates only on the web export when the page defined
## `window.QuickdrawBenchConfig` before engine boot (the wrapper only does
## that under `?bench=1`, dev-gated). When active it records, per render
## frame, the rendered position of every snake plus snapshot arrivals, input
## sends, reconciliation corrections, and FPS — and flushes batches to
## `window.QuickdrawBench.push(json)` every 500ms for Playwright to drain.
##
## Timestamps are epoch milliseconds (Date.now-aligned once at startup) so
## traces are directly comparable with the server's ground-truth record on
## the same machine.

const FLUSH_INTERVAL_MS := 500.0

var enabled := false

var _sink: JavaScriptObject = null
var _epoch_offset := 0.0
var _snakes: Dictionary = {}
var _frames: Array = []
var _snapshots: Array = []
var _inputs: Array = []
var _corrections: Array = []
var _fps: Array = []
var _last_flush := 0.0
var _last_fps_sample := 0.0


func _ready() -> void:
	if OS.get_name() != "Web":
		return
	var config: JavaScriptObject = JavaScriptBridge.get_interface("QuickdrawBenchConfig")
	_sink = JavaScriptBridge.get_interface("QuickdrawBench")
	if config == null or _sink == null:
		return
	_epoch_offset = JavaScriptBridge.eval("Date.now()", true) - Time.get_ticks_msec()
	enabled = true
	# No React dialog drives respawn in bench mode — do it ourselves
	Game.player_died.connect(_on_player_died)


func _on_player_died(death: Dictionary) -> void:
	if str(death.get("id", "")) != Game.my_id:
		return
	await get_tree().create_timer(0.75).timeout
	Game.respawn()


func now_ms() -> float:
	return _epoch_offset + Time.get_ticks_msec()


## main.gd calls these where snakes spawn/free (guarded by `enabled`).
func register_snake(id: String, node: Node2D) -> void:
	_snakes[id] = node


func unregister_snake(id: String) -> void:
	_snakes.erase(id)


func clear_snakes() -> void:
	_snakes.clear()


func on_snapshot(tick: int) -> void:
	_snapshots.append({"t": now_ms(), "tick": tick})


func on_input(seq: int) -> void:
	_inputs.append({"seq": seq, "t": now_ms()})


func on_correction(magnitude: float, hard: bool) -> void:
	_corrections.append({"t": now_ms(), "m": magnitude, "h": hard})


func _process(_delta: float) -> void:
	if not enabled:
		return
	var t := now_ms()

	var entities := {}
	for id in _snakes.keys():
		var node := _snakes[id] as Node2D
		if node != null and is_instance_valid(node):
			entities[id] = [node.position.x, node.position.y]
	_frames.append({"t": t, "e": entities})

	if t - _last_fps_sample >= 1000.0:
		_last_fps_sample = t
		_fps.append({"t": t, "v": Engine.get_frames_per_second()})

	if t - _last_flush >= FLUSH_INTERVAL_MS:
		_last_flush = t
		_flush()


func _flush() -> void:
	if _sink == null:
		return
	var batch := {
		"frames": _frames,
		"snapshots": _snapshots,
		"inputs": _inputs,
		"corrections": _corrections,
		"fps": _fps,
	}
	_sink.push(JSON.stringify(batch))
	_frames = []
	_snapshots = []
	_inputs = []
	_corrections = []
	_fps = []
