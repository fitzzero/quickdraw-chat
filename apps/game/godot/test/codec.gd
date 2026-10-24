extends SceneTree
## check:godot's codec step (apps/api/src/bench/godot-session.ts): decodes
## the packed snapshots apps/api/src/bench/codec-fixtures.ts made with the
## TS encoder, in order, with snapshot_decoder.gd, and compares each one
## received with what the TS decoder made of it, its `unnamed` and
## `needs_keyframe()` too. Prints `CODEC <checked> <mismatched>` and quits
## with 1 on a mismatch. Env: QD_CODEC_FIXTURES, the fixtures' JSON file.
##
## Loads the decoder by path: a --script main loop compiles before the
## project's global classes are known.


func _initialize() -> void:
	var text := FileAccess.get_file_as_string(OS.get_environment("QD_CODEC_FIXTURES"))
	var steps: Variant = JSON.parse_string(text)
	if not steps is Array:
		print("CODEC no fixtures")
		quit(1)
		return
	var decoder: RefCounted = load("res://scripts/snapshot_decoder.gd").new()
	var checked := 0
	var mismatched := 0
	for i in (steps as Array).size():
		var step: Dictionary = steps[i]
		# a lost snapshot never reaches the decoder
		if not step["received"]:
			continue
		var got: Dictionary = decoder.decode(str(step["b"]))
		var why := _same(got, step["expect"], "step %d" % i)
		if why == "" and decoder.unnamed != int(step["unnamed"]):
			why = "step %d: unnamed %d, expected %d" % [i, decoder.unnamed, int(step["unnamed"])]
		if why == "" and decoder.needs_keyframe() != bool(step["needsKeyframe"]):
			why = "step %d: needs_keyframe %s" % [i, decoder.needs_keyframe()]
		checked += 1
		if why != "":
			mismatched += 1
			print("CODEC mismatch ", why)
	print("CODEC %d %d" % [checked, mismatched])
	quit(1 if mismatched > 0 or checked == 0 else 0)


## "" when `a` (the GDScript decoder's) and `b` (the TS decoder's, through
## JSON, so every number a float) are the same, else where they differ.
func _same(a: Variant, b: Variant, path: String) -> String:
	if (a is float or a is int) and (b is float or b is int):
		return "" if absf(float(a) - float(b)) < 1e-6 else "%s: %s, expected %s" % [path, a, b]
	if a is Dictionary and b is Dictionary:
		if (a as Dictionary).size() != (b as Dictionary).size():
			return "%s: keys %s, expected %s" % [path, (a as Dictionary).keys(), (b as Dictionary).keys()]
		for key in a:
			if not (b as Dictionary).has(key):
				return "%s: no %s expected" % [path, key]
			var why := _same(a[key], b[key], "%s.%s" % [path, key])
			if why != "":
				return why
		return ""
	if a is Array and b is Array:
		if (a as Array).size() != (b as Array).size():
			return "%s: %d items, expected %d" % [path, (a as Array).size(), (b as Array).size()]
		for i in (a as Array).size():
			var why := _same(a[i], b[i], "%s[%d]" % [path, i])
			if why != "":
				return why
		return ""
	return "" if a == b else "%s: %s, expected %s" % [path, a, b]
