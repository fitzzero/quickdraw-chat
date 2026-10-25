// The client-side netcode, shared by the web page and the bench bots: the
// local predictor (local_snake.gd), the remote interpolators
// (remote_snake.gd), the world clock and its playback delay (game.gd), the
// food (main.gd), the transport a wire implements, and GameClientCore,
// which drives them all for a shell.
export * from "./core.js";
export * from "./food.js";
export * from "./interpolation.js";
export * from "./playback-delay.js";
export * from "./prediction.js";
export * from "./transport.js";
export * from "./world-clock.js";
