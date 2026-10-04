// What jsdom leaves out that these tests need. It runs after the API's test
// setup (vitest.int.config.ts), before any test's hooks.
import { Blob as NodeBlob } from "node:buffer";

// jsdom lays nothing out, so there is nothing to scroll (the message list
// follows its newest message)
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = (): void => undefined;
}

// The API's setup loads each worker's PGlite database from a Blob's
// arrayBuffer(), which jsdom's Blob lacks: use Node's
if (typeof Blob.prototype.arrayBuffer !== "function") {
  globalThis.Blob = NodeBlob as unknown as typeof Blob;
}
