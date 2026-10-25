class_name SnapshotDecoder
extends RefCounted
## Unpacks the world stream's packed snapshots (the item's `b`, base64),
## learning the stream's id table: the port of SnapshotDecoder in
## packages/shared/src/game/snapshotDecoder.ts (keep the two in lockstep;
## the layout is in snapshotCodec.ts beside it). A snapshot comes out as its
## JSON did: tick, t, players (id, x, y, dx, dy, len, boost, ack, and late
## when set) and food (tick, spawned, eaten).
##
## Each snapshot introduces the players first introduced in its last
## ticks, and a keyframe all of them; the newest given wins (a keyframe may
## be handled after newer snapshots), and a keyframe older than the newest
## snapshot's window names nobody. A snapshot whose newest unrepeated
## introduction is past the newest snapshot decoded means one was missed:
## the table is forgotten, and a player the decoder cannot name is left out
## (`unnamed`) until a keyframe names them all again. One per client, kept
## across its subscriptions and reset when the clock follows another
## server's world (its ticks start over).

const VERSION := 2
const FLAG_T := 1
const FLAG_KEYFRAME := 2
## GameConfig.FOOD_WINDOW: the ticks a snapshot repeats introductions over
const FOOD_WINDOW := 6
const PLAYER_BYTES := 23
## A player's flags: it boosts; the server adopted a late frame (PlayerSnap.late)
const PLAYER_BOOST := 1
const PLAYER_LATE := 2
const SPAWNED_BYTES := 13

## index → [id, the tick it was given]
var _names := {}
## The newest snapshot tick decoded (-1: none yet)
var _last_tick := -1
var _keyframed := false
## Players the last decode left out: their index was never introduced here
var unnamed := 0


## Forgets the table (another server's world).
func reset() -> void:
	_names.clear()
	_last_tick = -1
	_keyframed = false
	unnamed = 0


## A keyframe named every player once, and the last decode still left one
## out: the client asks for a keyframe (before the first one, it is on its way).
func needs_keyframe() -> bool:
	return _keyframed and unnamed > 0


## The snapshot a stream item's `b` holds; empty for another layout's.
func decode(packed: String) -> Dictionary:
	var bytes := Marshalls.base64_to_raw(packed)
	if bytes.size() < 10 or bytes.decode_u8(0) != VERSION:
		push_warning("SnapshotDecoder: not a version %d snapshot" % VERSION)
		return {}
	var flags := bytes.decode_u8(1)
	var keyframe := (flags & FLAG_KEYFRAME) != 0
	var tick := bytes.decode_u32(2)
	var unrepeated := bytes.decode_u32(6) - 1
	var at := 10
	var snapshot := {"tick": tick}
	if flags & FLAG_T:
		# A float is 64-bit here: never put epoch ms in a Vector2 (float32)
		snapshot["t"] = bytes.decode_double(at)
		at += 8

	# An index first introduced after the newest snapshot decoded, and no
	# longer introduced: a name held may stand for another player
	if _last_tick >= 0 and unrepeated > _last_tick:
		_names.clear()
	# A seed older than the newest snapshot's window (this client hands a
	# seed over after the items that came with it) may name an index by an
	# owner whose newer give no snapshot introduces any more: it names nobody
	var skip := keyframe and tick < _last_tick - FOOD_WINDOW
	var intros := bytes.decode_u16(at)
	at += 2
	for i in intros:
		var index := bytes.decode_u16(at)
		var given := bytes.decode_u32(at + 2)
		var length := bytes.decode_u8(at + 6)
		var id := bytes.slice(at + 7, at + 7 + length).get_string_from_utf8()
		at += 7 + length
		if skip:
			continue
		var known: Variant = _names.get(index)
		if known == null or int((known as Array)[1]) <= given:
			_names[index] = [id, given]

	var left_out := 0
	var players: Array = []
	var count := bytes.decode_u16(at)
	at += 2
	for i in count:
		var name: Variant = _names.get(bytes.decode_u16(at))
		if name == null:
			left_out += 1
		else:
			var player_flags := bytes.decode_u8(at + 18)
			var player := {
				"id": (name as Array)[0],
				"x": bytes.decode_u32(at + 2) / 10.0,
				"y": bytes.decode_u32(at + 6) / 10.0,
				"dx": bytes.decode_s16(at + 10) / 1000.0,
				"dy": bytes.decode_s16(at + 12) / 1000.0,
				"len": bytes.decode_float(at + 14),
				"boost": (player_flags & PLAYER_BOOST) != 0,
				"ack": bytes.decode_u32(at + 19),
			}
			# `late` only when set, as the TS decoder gives it
			if (player_flags & PLAYER_LATE) != 0:
				player["late"] = true
			players.append(player)
		at += PLAYER_BYTES
	snapshot["players"] = players

	var entries := bytes.decode_u8(at)
	at += 1
	if entries > 0:
		var food: Array = []
		for i in entries:
			var entry := {"tick": bytes.decode_u32(at)}
			var spawned := bytes.decode_u16(at + 4)
			at += 6
			if spawned > 0 or keyframe:
				var items: Array = []
				for j in spawned:
					items.append({
						"id": "f%d" % bytes.decode_u32(at),
						"x": bytes.decode_u32(at + 4) / 10.0,
						"y": bytes.decode_u32(at + 8) / 10.0,
						"v": bytes.decode_u8(at + 12),
					})
					at += SPAWNED_BYTES
				entry["spawned"] = items
			var eaten := bytes.decode_u16(at)
			at += 2
			if eaten > 0:
				var ids: Array = []
				for j in eaten:
					ids.append("f%d" % bytes.decode_u32(at))
					at += 4
				entry["eaten"] = ids
			food.append(entry)
		snapshot["food"] = food

	if keyframe:
		_keyframed = true
	_last_tick = maxi(_last_tick, tick)
	unnamed = left_out
	return snapshot
