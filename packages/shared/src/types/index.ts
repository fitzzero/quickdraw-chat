// Service/type modules — one file per concern. When adding a new service,
// add its DTOs + <Name>ServiceMethods as a new file here and register it in
// service-methods.ts (ServiceMethodsMap / SubscriptionDataMap). Custom room
// events go in events.ts (QuickdrawEventMap augmentation).

// Side-effect import: loads the QuickdrawEventMap augmentation into every
// consumer's type graph.
// oxlint-disable-next-line import/no-unassigned-import -- module augmentation has no bindings
import "./events.js";

export type * from "./access.js";
export type * from "./user.js";
export type * from "./chat.js";
export type * from "./message.js";
export type * from "./document.js";
export type * from "./service-methods.js";
export type * from "./admin.js";
