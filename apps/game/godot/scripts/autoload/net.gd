extends Node
## Net (autoload) — owns the QuickdrawClient and resolves host configuration.
##
## Config sources, in order:
## 1. Web export: the wrapper page sets `window.QuickdrawHost` BEFORE the
##    engine starts: { apiUrl, socketPath, authToken|null, worldSlug }.
##    Cookie auth needs no token — the browser attaches the session cookie
##    to the websocket handshake (same-site in dev, SameSite=None in prod).
## 2. Editor/desktop: QUICKDRAW_DEV_USER_ID env var or user://dev.json
##    ({"api_url": ..., "user_id": ...}) against the local API's dev
##    credentials (ENABLE_DEV_CREDENTIALS=true, the dev default).

signal ready_to_join

var client: QuickdrawClient
var api_url := "http://localhost:4000"
var socket_path := "/socket.io"
var auth: Dictionary = {}
var world_slug := "global"
var config_ok := false


func _ready() -> void:
	client = QuickdrawClient.new()
	client.name = "QuickdrawClient"
	add_child(client)

	_resolve_config()
	if not config_ok:
		push_warning("Net: no auth configured — see apps/game/README.md (dev auth)")
		return

	client.connected.connect(_on_connected)
	client.connect_to(api_url, {"path": socket_path, "auth": auth})


func _on_connected() -> void:
	ready_to_join.emit()


func _resolve_config() -> void:
	if OS.has_feature("web"):
		_resolve_web_config()
	else:
		_resolve_dev_config()


func _resolve_web_config() -> void:
	var host: JavaScriptObject = JavaScriptBridge.get_interface("QuickdrawHost")
	if host == null:
		push_warning("Net: window.QuickdrawHost missing — set it before engine start")
		return

	api_url = str(host.apiUrl) if host.apiUrl else api_url
	if host.socketPath:
		socket_path = str(host.socketPath)
	if host.worldSlug:
		world_slug = str(host.worldSlug)
	# Token auth (Discord Activity); otherwise the cookie rides the handshake
	if host.authToken:
		auth = {"token": str(host.authToken)}
	else:
		auth = {}
	config_ok = true


func _resolve_dev_config() -> void:
	var user_id := OS.get_environment("QUICKDRAW_DEV_USER_ID")
	var env_api := OS.get_environment("QUICKDRAW_API_URL")
	if not env_api.is_empty():
		api_url = env_api

	if user_id.is_empty() and FileAccess.file_exists("user://dev.json"):
		var file := FileAccess.open("user://dev.json", FileAccess.READ)
		var parsed: Variant = JSON.parse_string(file.get_as_text())
		if parsed is Dictionary:
			var cfg := parsed as Dictionary
			user_id = str(cfg.get("user_id", ""))
			api_url = str(cfg.get("api_url", api_url))

	if user_id.is_empty():
		return

	auth = {"userId": user_id}
	config_ok = true


## Signal the wrapper page that the game booted (drives the loading overlay).
func notify_web_ready() -> void:
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.dispatchEvent(new Event('godot:ready'))", true)
