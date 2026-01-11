/**
 * Socket test utilities for integration tests.
 * 
 * These are thin wrappers that return raw Socket instances to match the test patterns.
 * For the full TestClient interface with emit() helper, use @fitzzero/quickdraw-core/server/testing.
 */
import { io as ioClient, type Socket } from "socket.io-client";
import type { ServiceResponse } from "@project/shared";

export { getAvailablePort } from "@fitzzero/quickdraw-core/server/testing";

/**
 * Connect to a test server as a specific user.
 * Returns a raw Socket (unlike core's TestClient wrapper).
 */
export async function connectAsUser(port: number, userId: string): Promise<Socket> {
  const socket = ioClient(`http://localhost:${port}`, {
    auth: { userId },
    transports: ["websocket"],
    autoConnect: true,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Connection timeout"));
    }, 5000);

    socket.on("connect", () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return socket;
}

/**
 * Emit an event and wait for acknowledgment.
 */
export function emitWithAck<TPayload, TResponse>(
  socket: Socket,
  event: string,
  payload: TPayload,
  timeoutMs = 5000 as number
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeoutMs);

    socket.emit(event, payload, (response: ServiceResponse<TResponse>) => {
      clearTimeout(timeout);

      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}

/**
 * Wait for a specific socket event.
 */
export function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 5000 as number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for event ${event}`));
    }, timeoutMs);

    const handler = (data: T): void => {
      clearTimeout(timeout);
      socket.off(event, handler);
      resolve(data);
    };

    socket.on(event, handler);
  });
}
