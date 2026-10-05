// What jsdom leaves out that these tests need: element scrolling (the message
// list follows its newest message) and Blob.prototype.arrayBuffer. It runs
// after the API's test setup (vitest.int.config.ts), before any test's hooks.
import { installJsdomShims } from "@fitzzero/quickdraw-core/testing/client";

installJsdomShims();
