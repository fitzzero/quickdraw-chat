// What jsdom leaves out, or the runtime hides, that these tests need: element
// scrolling (the message list follows its newest message),
// Blob.prototype.arrayBuffer, and jsdom's own storage. Both vitest configs
// list it; in vitest.int.config.ts it runs after the API's test setup,
// before any test's hooks.
import { installJsdomShims } from "@fitzzero/quickdraw-core/testing/client";

installJsdomShims();

// Node 25 and later have a localStorage and sessionStorage of their own,
// undefined without --localstorage-file, and vitest's jsdom environment
// keeps a global the runtime already has, so jsdom's storage never shows
// (IntlProvider reads the locale from it). Put jsdom's in their place,
// without reading Node's (which warns): on CI's Node 24, which has neither,
// vitest already put the same objects there.
const { jsdom } = globalThis as {
  jsdom?: { window: Pick<Window, "localStorage" | "sessionStorage"> };
};
if (jsdom !== undefined) {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, key, {
      value: jsdom.window[key],
      configurable: true,
      writable: true,
    });
  }
}
