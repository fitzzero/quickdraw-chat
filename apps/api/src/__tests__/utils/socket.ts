import { io as ioClient, type Socket } from "socket.io-client";
import type { ServiceResponse } from "@project/shared";

let nextPort = 10000;

/**
 * Get an available port for testing
 */
export function getAvailablePort(): number {
  return nextPort++;
}

/**
 * Connect to a test server as a specific user
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
 * Emit an event and wait for acknowledgment
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
 * Wait for a specific socket event
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
