// Known service room prefixes — add new services here
type ServiceRoomName = "userService" | "chatService" | "messageService" | "documentService";

/** Type-safe room string: `{service}:{entityId}` */
export function serviceRoom(service: ServiceRoomName, entityId: string): string {
  return `${service}:${entityId}`;
}

/** User-scoped room: `user:{userId}` */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}
