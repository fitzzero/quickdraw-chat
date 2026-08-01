// Thin typed wrappers over core's static room helpers: same wire format,
// but the service name is constrained to this app's registered services so
// a typo can't silently target an empty room.
import {
  serviceRoom as coreServiceRoom,
  collectionRoom as coreCollectionRoom,
  userRoom as coreUserRoom,
} from "@fitzzero/quickdraw-core";

// Known service room prefixes — add new services here
type ServiceRoomName =
  | "userService"
  | "chatService"
  | "messageService"
  | "documentService"
  | "pushService"
  // ── quickdraw-game:start ──
  | "gameService"
  | "definitionService";
// ── quickdraw-game:end ──

/** Type-safe room string: `{service}:{entityId}` */
export function serviceRoom(service: ServiceRoomName, entityId: string): string {
  return coreServiceRoom(service, entityId);
}

/**
 * Collection scope room (== delta event name):
 * `{service}:collection:{collection}:{scopeId}`
 */
export function collectionRoom(
  service: ServiceRoomName,
  collection: string,
  scopeId: string,
): string {
  return coreCollectionRoom(service, collection, scopeId);
}

/** User-scoped room: `user:{userId}` */
export function userRoom(userId: string): string {
  return coreUserRoom(userId);
}
