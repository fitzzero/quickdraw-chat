/**
 * ServiceRegistry for template - follows @quickdraw/core patterns
 * 
 * NOTE: This is a local implementation. Once @quickdraw/core is published,
 * you can replace this with:
 * 
 *   import { ServiceRegistry } from '@quickdraw/core/server';
 * 
 * And delete this file.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { ServiceResponse, AccessLevel } from "@project/shared";
import type { QuickdrawSocket, ServiceMethodDefinition, ServiceMethodContext } from "./BaseService";
import { logger } from "../utils/logger";

interface BaseServiceInstance {
  serviceName: string;
  subscribe: (entryId: string, socket: QuickdrawSocket, requiredLevel?: AccessLevel) => Promise<unknown>;
  unsubscribe: (entryId: string, socket: QuickdrawSocket) => void;
  unsubscribeSocket: (socket: QuickdrawSocket) => void;
  ensureAccessForMethod: (requiredLevel: AccessLevel, socket: QuickdrawSocket, entryId?: string) => Promise<void>;
  getPublicMethods: () => ServiceMethodDefinition<unknown, unknown>[];
}

export class ServiceRegistry {
  private readonly io: SocketIOServer;
  private readonly services: Map<string, BaseServiceInstance> = new Map();

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  public registerService(serviceName: string, service: BaseServiceInstance): void {
    this.services.set(serviceName, service);
    logger.info(`Registered service: ${serviceName}`);
    this.discoverServiceMethods(serviceName, service);
  }

  private discoverServiceMethods(serviceName: string, service: BaseServiceInstance): void {
    const methods = service.getPublicMethods();

    for (const method of methods) {
      const eventName = `${serviceName}:${method.name}`;
      logger.info(`Registering socket event: ${eventName}`);

      this.io.on("connection", (socket) => {
        this.registerMethodListener(socket as QuickdrawSocket, eventName, method, service);
      });
    }

    // Subscription handlers
    this.io.on("connection", (socket) => {
      this.registerSubscriptionListener(socket as QuickdrawSocket, `${serviceName}:subscribe`, service);
      this.registerUnsubscriptionListener(socket as QuickdrawSocket, `${serviceName}:unsubscribe`, service);
    });
  }

  private registerMethodListener(
    socket: QuickdrawSocket,
    eventName: string,
    method: ServiceMethodDefinition<unknown, unknown>,
    service: BaseServiceInstance
  ): void {
    socket.on(eventName, async (payload: unknown, callback?: (response: ServiceResponse<unknown>) => void) => {
      const startedAt = Date.now();
      const [serviceName, methodName] = eventName.split(":");
      const userIdShort = socket.userId?.slice(0, 8) ?? "anon";

      try {
        if (!socket.userId && method.access !== "Public") {
          callback?.({ success: false, error: "Authentication required", code: 401 });
          return;
        }

        // Resolve entry ID
        let entryId: string | undefined;
        if (method.resolveEntryId) {
          entryId = method.resolveEntryId(payload) ?? undefined;
        } else if (payload && typeof payload === "object" && "id" in payload) {
          const idValue = (payload as Record<string, unknown>).id;
          if (typeof idValue === "string") entryId = idValue;
        }

        await service.ensureAccessForMethod(method.access, socket, entryId);

        logger.info(`User ${userIdShort} ${serviceName}.${methodName} -> start`);

        const context: ServiceMethodContext = {
          userId: socket.userId,
          socketId: socket.id,
          serviceAccess: socket.serviceAccess ?? {},
        };

        const result = await method.handler(payload, context);

        const durationMs = Date.now() - startedAt;
        logger.info(`User ${userIdShort} ${serviceName}.${methodName} -> success (${durationMs}ms)`);

        callback?.({ success: true, data: result });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        logger.error(`User ${userIdShort} ${serviceName}.${methodName} -> fail (${durationMs}ms)`, {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        callback?.({
          success: false,
          error: error instanceof Error ? error.message : "Internal error",
          code: 500,
        });
      }
    });
  }

  private registerSubscriptionListener(
    socket: QuickdrawSocket,
    eventName: string,
    service: BaseServiceInstance
  ): void {
    socket.on(
      eventName,
      async (
        payload: { entryId: string; requiredLevel?: string },
        callback?: (response: ServiceResponse<unknown>) => void
      ) => {
        try {
          if (!socket.userId) {
            callback?.({ success: false, error: "Authentication required", code: 401 });
            return;
          }

          const data = await service.subscribe(
            payload.entryId,
            socket,
            (payload.requiredLevel as AccessLevel) ?? "Read"
          );

          if (data === null) {
            callback?.({ success: false, error: "Access denied or entry not found", code: 403 });
            return;
          }

          callback?.({ success: true, data });
        } catch (error) {
          logger.error(`Error in subscription ${eventName}:`, {
            error: error instanceof Error ? error.message : "Unknown error",
          });
          callback?.({
            success: false,
            error: error instanceof Error ? error.message : "Subscription failed",
          });
        }
      }
    );
  }

  private registerUnsubscriptionListener(
    socket: QuickdrawSocket,
    eventName: string,
    service: BaseServiceInstance
  ): void {
    socket.on(
      eventName,
      (
        payload: { entryId: string },
        callback?: (response: ServiceResponse<{ unsubscribed: true; entryId: string }>) => void
      ) => {
        try {
          service.unsubscribe(payload.entryId, socket);
          callback?.({ success: true, data: { unsubscribed: true, entryId: payload.entryId } });
        } catch (error) {
          callback?.({
            success: false,
            error: error instanceof Error ? error.message : "Unsubscription failed",
          });
        }
      }
    );
  }

  public getServices(): string[] {
    return Array.from(this.services.keys());
  }

  public getServiceInstances(): BaseServiceInstance[] {
    return Array.from(this.services.values());
  }
}
