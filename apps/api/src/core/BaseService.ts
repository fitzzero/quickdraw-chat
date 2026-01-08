/**
 * BaseService for template - follows @quickdraw/core patterns
 * 
 * NOTE: This is a local implementation. Once @quickdraw/core is published,
 * you can replace this with:
 * 
 *   import { BaseService } from '@quickdraw/core/server';
 * 
 * And delete this file.
 */

import type { Socket } from "socket.io";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@project/db";
import type { AccessLevel, ACL, ServiceResponse } from "@project/shared";
import { logger } from "../utils/logger";

export interface ServiceMethodContext {
  userId: string | undefined;
  socketId: string;
  serviceAccess: Record<string, AccessLevel>;
}

export interface ServiceMethodDefinition<TPayload = unknown, TResponse = unknown> {
  name: string;
  access: AccessLevel;
  handler: (payload: TPayload, context: ServiceMethodContext) => Promise<TResponse>;
  resolveEntryId?: (payload: TPayload) => string | null;
}

export interface QuickdrawSocket extends Socket {
  userId?: string;
  serviceAccess?: Record<string, AccessLevel>;
}

interface BaseServiceOptions {
  serviceName: string;
  hasEntryACL?: boolean;
}

export abstract class BaseService<
  TEntity extends { id: string },
  TCreateInput extends Record<string, unknown>,
  TUpdateInput extends Record<string, unknown>,
  TServiceMethods extends Record<string, { payload: unknown; response: unknown }>,
> {
  public readonly serviceName: string;
  protected readonly hasEntryACL: boolean;
  protected readonly db: PrismaClient;
  protected readonly subscribers: Map<string, Set<QuickdrawSocket>> = new Map();
  private readonly publicMethods: Map<string, ServiceMethodDefinition<unknown, unknown>> = new Map();

  constructor(options: BaseServiceOptions) {
    this.serviceName = options.serviceName;
    this.hasEntryACL = options.hasEntryACL ?? false;
    this.db = prisma;
  }

  // Abstract method for getting the Prisma delegate
  protected abstract getDelegate(): {
    findUnique: (args: { where: { id: string }; select?: Record<string, unknown> }) => Promise<TEntity | null>;
    findMany: (args?: Record<string, unknown>) => Promise<TEntity[]>;
    create: (args: { data: TCreateInput }) => Promise<TEntity>;
    update: (args: { where: { id: string }; data: TUpdateInput }) => Promise<TEntity>;
    delete: (args: { where: { id: string } }) => Promise<TEntity>;
  };

  // Subscription Management
  public async subscribe(
    entryId: string,
    socket: QuickdrawSocket,
    requiredLevel: AccessLevel = "Read"
  ): Promise<TEntity | null> {
    if (!socket.userId) return null;

    const allowed = await this.checkSubscriptionAccess(socket.userId, entryId, requiredLevel, socket);
    if (!allowed) return null;

    if (!this.subscribers.has(entryId)) {
      this.subscribers.set(entryId, new Set());
    }
    this.subscribers.get(entryId)!.add(socket);

    logger.debug(`User ${socket.userId} subscribed to ${this.serviceName}:${entryId}`);
    return await this.findById(entryId);
  }

  public unsubscribe(entryId: string, socket: QuickdrawSocket): void {
    const subs = this.subscribers.get(entryId);
    if (subs) {
      subs.delete(socket);
      if (subs.size === 0) this.subscribers.delete(entryId);
    }
  }

  public unsubscribeSocket(socket: QuickdrawSocket): void {
    for (const [entryId, sockets] of this.subscribers.entries()) {
      if (sockets.has(socket)) {
        sockets.delete(socket);
        if (sockets.size === 0) this.subscribers.delete(entryId);
      }
    }
  }

  protected emitUpdate(entryId: string, data: Partial<TEntity>): void {
    const eventName = `${this.serviceName}:update:${entryId}`;
    const subs = this.subscribers.get(entryId);
    if (subs) {
      for (const socket of subs) {
        socket.emit(eventName, data);
      }
    }
  }

  // Access Control
  protected async checkSubscriptionAccess(
    userId: string,
    entryId: string,
    requiredLevel: AccessLevel,
    socket: QuickdrawSocket
  ): Promise<boolean> {
    if (this.hasServiceAccess(socket, requiredLevel)) return true;
    if (this.checkAccess(userId, entryId, requiredLevel, socket)) return true;
    if (this.hasEntryACL) return await this.checkEntryACL(userId, entryId, requiredLevel);
    return false;
  }

  protected hasServiceAccess(socket: QuickdrawSocket, requiredLevel: AccessLevel): boolean {
    const userLevel = socket.serviceAccess?.[this.serviceName];
    if (!userLevel) return false;
    return this.isLevelSufficient(userLevel, requiredLevel);
  }

  protected checkAccess(
    _userId: string,
    _entryId: string,
    _requiredLevel: AccessLevel,
    _socket: QuickdrawSocket
  ): boolean {
    return false; // Override in derived classes
  }

  protected async checkEntryACL(
    userId: string,
    entryId: string,
    requiredLevel: AccessLevel
  ): Promise<boolean> {
    try {
      const entity = await this.getDelegate().findUnique({
        where: { id: entryId },
        select: { acl: true },
      });
      const acl = (entity as unknown as { acl?: ACL })?.acl;
      if (!acl || !Array.isArray(acl)) return false;
      const ace = acl.find((a) => a.userId === userId);
      if (!ace) return false;
      return this.isLevelSufficient(ace.level, requiredLevel);
    } catch {
      return false;
    }
  }

  protected isLevelSufficient(userLevel: AccessLevel, requiredLevel: AccessLevel): boolean {
    const order: Record<AccessLevel, number> = { Public: 0, Read: 1, Moderate: 2, Admin: 3 };
    return (order[userLevel] ?? 0) >= (order[requiredLevel] ?? 0);
  }

  public async ensureAccessForMethod(
    requiredLevel: AccessLevel,
    socket: QuickdrawSocket,
    entryId?: string
  ): Promise<void> {
    if (requiredLevel === "Public") return;
    if (!socket.userId) throw new Error("Authentication required");
    if (this.hasServiceAccess(socket, requiredLevel)) return;
    
    if (entryId) {
      if (this.checkAccess(socket.userId, entryId, requiredLevel, socket)) return;
      if (this.hasEntryACL && (await this.checkEntryACL(socket.userId, entryId, requiredLevel))) return;
      throw new Error("Insufficient permissions");
    }
    
    if (requiredLevel === "Read") return;
    throw new Error("Insufficient permissions");
  }

  // CRUD Operations
  protected async findById(id: string): Promise<TEntity | null> {
    return await this.getDelegate().findUnique({ where: { id } });
  }

  protected async create(data: TCreateInput): Promise<TEntity> {
    const entity = await this.getDelegate().create({ data });
    this.emitUpdate(entity.id, entity);
    logger.info(`${this.serviceName}: Created entity ${entity.id}`);
    return entity;
  }

  protected async update(id: string, data: TUpdateInput): Promise<TEntity | null> {
    try {
      const entity = await this.getDelegate().update({ where: { id }, data });
      this.emitUpdate(id, entity);
      logger.info(`${this.serviceName}: Updated entity ${id}`);
      return entity;
    } catch {
      return null;
    }
  }

  protected async delete(id: string): Promise<boolean> {
    try {
      await this.getDelegate().delete({ where: { id } });
      this.emitUpdate(id, { id, deleted: true } as unknown as Partial<TEntity>);
      logger.info(`${this.serviceName}: Deleted entity ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  // Method Definition
  protected defineMethod<K extends keyof TServiceMethods & string>(
    name: K,
    access: AccessLevel,
    handler: (
      payload: TServiceMethods[K]["payload"],
      context: ServiceMethodContext
    ) => Promise<TServiceMethods[K]["response"]>,
    options?: { resolveEntryId?: (payload: TServiceMethods[K]["payload"]) => string | null }
  ): ServiceMethodDefinition<TServiceMethods[K]["payload"], TServiceMethods[K]["response"]> {
    const definition: ServiceMethodDefinition<TServiceMethods[K]["payload"], TServiceMethods[K]["response"]> = {
      name,
      access,
      handler: handler as (
        payload: TServiceMethods[K]["payload"],
        context: ServiceMethodContext
      ) => Promise<TServiceMethods[K]["response"]>,
      resolveEntryId: options?.resolveEntryId,
    };
    this.publicMethods.set(name, definition as ServiceMethodDefinition<unknown, unknown>);
    return definition;
  }

  public getPublicMethods(): ServiceMethodDefinition<unknown, unknown>[] {
    return Array.from(this.publicMethods.values());
  }
}
