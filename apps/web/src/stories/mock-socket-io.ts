// Storybook-only stand-in for the `socket.io-client` module. `.storybook/main.ts`
// aliases "socket.io-client" to this file in the Storybook bundle, so the REAL
// QuickdrawProvider, subscription registry, batcher, and hooks all run
// unmodified over a fake socket. Stories configure responses per story via
// `withMockSocket` (see decorators.tsx), typically with `mockSuccessEmit` /
// `mockErrorEmit` from `@fitzzero/quickdraw-core/client/testing`.
//
// This exists because core 4.1's `createTestWrapper` provides a context object
// private to its own chunk (dist/client/testing.js) that no client hook reads.
// Once core shares the real QuickdrawSocketContext, this shim can be deleted.

type EmitCallback = (response: unknown) => void;
export type MockEmitHandler = (event: string, payload: unknown, callback?: EmitCallback) => void;

export interface MockSocketBehavior {
  /** Answers callback-style emits (service methods, subscribes, collections). */
  emit?: MockEmitHandler;
  /** Delivered via the auth:info handshake; null renders the signed-out state. */
  userId?: string | null;
  /** Set false to never fire "connect" — components show disconnected states. */
  connected?: boolean;
}

// Keyed by serverUrl: docs pages mount several stories at once, so each story
// gets its own URL (withMockSocket derives it from the story id) and io()
// picks the matching behavior — a single global would leak the last-rendered
// story's mocks into its siblings.
const behaviors = new Map<string, MockSocketBehavior>();

/** Called by the withMockSocket decorator before each story mounts. */
export function setMockSocketBehavior(url: string, next: MockSocketBehavior | undefined): void {
  behaviors.set(url, next ?? {});
}

type Listener = (...args: unknown[]) => void;

/** Drop-in for socket.io-client's io() — only what QuickdrawProvider uses. */
export function io(url?: unknown, _opts?: unknown) {
  const behavior = behaviors.get(String(url)) ?? {};
  const listeners = new Map<string, Set<Listener>>();
  const fire = (event: string, ...args: unknown[]): void => {
    listeners.get(event)?.forEach((listener) => {
      listener(...args);
    });
  };

  const socket = {
    id: "storybook-mock-socket",
    connected: false,
    on(event: string, listener: Listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return socket;
    },
    off(event: string, listener?: Listener) {
      if (listener) {
        listeners.get(event)?.delete(listener);
      } else {
        listeners.delete(event);
      }
      return socket;
    },
    emit(event: string, payload?: unknown, callback?: EmitCallback) {
      behavior.emit?.(event, payload, callback);
      return socket;
    },
    disconnect() {
      socket.connected = false;
      fire("disconnect", "io client disconnect");
      return socket;
    },
  };

  // The provider registers its listeners synchronously after io() returns;
  // handshake on the next tick so none of them miss the events.
  setTimeout(() => {
    if (behavior.connected === false || socket.connected) return;
    socket.connected = true;
    fire("connect");
    fire("auth:info", {
      userId: behavior.userId === undefined ? "storybook-user" : behavior.userId,
      serviceAccess: {},
    });
  }, 0);

  return socket;
}
