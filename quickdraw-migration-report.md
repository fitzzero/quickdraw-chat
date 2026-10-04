# quickdraw 5.0 migration report

Written by `@fitzzero/quickdraw-codemod` from the `// quickdraw-migrate: review` markers in the code; running the codemod again rewrites it from the markers that remain. Work through the sections in order (contracts, access, emits, client), delete each marker once its item is done, and see the migration guide (`MIGRATION.md`, shipped in `@fitzzero/quickdraw-codemod`) for each kind of item. Then run lint (`no-v4-api` names every 4.x API left, `no-todo-schema` every placeholder) and the typecheck.

218 items in 51 files.

| Section                                                        | Items |
| -------------------------------------------------------------- | ----: |
| Access                                                         |    16 |
| Access overrides to turn into a policy                         |    10 |
| toDto and protected fields to turn into projections and fields |     6 |
| Collections to declare in contracts                            |     2 |
| Hand emits to delete                                           |     9 |
| this.create, this.update and this.delete to write through db   |     7 |
| Lifecycle hooks                                                |     2 |
| installAdminMethods to replace with the admin kit              |     7 |
| Methods a kit implements                                       |    11 |
| Service instance state and the 4.x context                     |    42 |
| Client                                                         |    24 |
| Server wiring and other 4.x APIs                               |    82 |

## Access

The forms admit exactly the callers 4.x admitted, and `jsonAcl("acl")` the rows 4.x's `hasEntryACL` did, but for a user listed twice in a row's list (marked). "Read" without a row id was open to every signed-in user; decide whether that was meant. A method whose input has `id` under a form that checks no row ("public", say) carries `rowless: true` (marked): 5.0 refuses to define that shape on a service with an access policy without it, and it keeps the 4.x callers.

- [ ] `apps/api/src/services/chat/index.ts:95` this.isLevelSufficient: compare levels in a policy or a custom(fn) form (Public < Read < Moderate < Admin)
- [ ] `apps/api/src/services/chat/index.ts:252` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/document/index.ts:103` this.isLevelSufficient: compare levels in a policy or a custom(fn) form (Public < Read < Moderate < Admin)
- [ ] `apps/api/src/services/document/index.ts:130` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/document/index.ts:185` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:245` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:289` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:299` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:326` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/message/index.ts:92` this.isLevelSufficient: compare levels in a policy or a custom(fn) form (Public < Read < Moderate < Admin)
- [ ] `apps/api/src/services/message/index.ts:149` 4.x's hasEntryACL read the row's `acl` column ([{ userId, level }]), and so does jsonAcl("acl"), with one difference: a user with several entries in a row's list gets the highest of their levels, where 4.x took the first. Check the stored lists for duplicate entries
- [ ] `apps/api/src/services/message/index.ts:153` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/push-subscription/index.ts:213` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/push-subscription/index.ts:222` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/push-subscription/index.ts:232` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/user/index.ts:94` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant

## Access overrides to turn into a policy

4.x decided row access in overridden methods; 5.0 decides it in the service's `access` policy, for every surface at once.

- [ ] `apps/api/src/services/chat/index.ts:71` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/chat/index.ts:83` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/chat/index.ts:247` 4.x decided row access in checkAccess and checkEntryACL (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
- [ ] `apps/api/src/services/document/index.ts:61` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/document/index.ts:78` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/document/index.ts:125` 4.x decided row access in checkAccess and checkEntryACL (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
- [ ] `apps/api/src/services/game/index.ts:57` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/game/index.ts:241` 4.x decided row access in checkAccess (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass
- [ ] `apps/api/src/services/user/index.ts:66` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/user/index.ts:90` 4.x decided row access in checkAccess (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass

## toDto and protected fields to turn into projections and fields

Subscribers receive the contract's projections, built from rows, with field levels from the contract's `fields`.

- [ ] `apps/api/src/services/chat/index.ts:59` 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
- [ ] `apps/api/src/services/definition/index.ts:45` 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
- [ ] `apps/api/src/services/document/index.ts:44` 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
- [ ] `apps/api/src/services/message/index.ts:63` 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
- [ ] `apps/api/src/services/user/index.ts:54` 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function
- [ ] `apps/api/src/services/user/index.ts:83` protected fields: declare them in the contract's fields with the level that may read each one (fields: { email: "Admin" }), then delete this function

## Collections to declare in contracts

A 4.x `defineCollection` becomes a contract collection (`scope`, `item`, `order`, and `index` plus `views` for boards) anchored in `defineService`.

- [ ] `apps/api/src/services/chat/index.ts:24` 4.x collection "myChats": declare it in the contract's collections (scope, item, order) and anchor it in defineService's collections, then delete this; it is no longer used
- [ ] `apps/api/src/services/message/index.ts:26` 4.x collection "byChat": declare it in the contract's collections (scope, item, order) and anchor it in defineService's collections, then delete this; it is no longer used

## Hand emits to delete

5.0 sends entity frames and collection deltas from tracked writes; room events become contract events.

- [ ] `apps/api/src/services/chat/index.ts:195` hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
- [ ] `apps/api/src/services/chat/index.ts:241` room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
- [ ] `apps/api/src/services/chat/index.ts:291` hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
- [ ] `apps/api/src/services/chat/index.ts:374` hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
- [ ] `apps/api/src/services/chat/index.ts:391` hand emit: 5.0 sends collection deltas from tracked writes; write through db and let the tracked write emit, then delete this hand emit once the collection is declared in the contract
- [ ] `apps/api/src/services/game/index.ts:100` room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
- [ ] `apps/api/src/services/game/index.ts:263` room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
- [ ] `apps/api/src/services/game/index.ts:307` room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)
- [ ] `apps/api/src/services/user/index.ts:146` hand emit: 5.0 sends entity frames from tracked writes; delete this once the write goes through db

## this.create, this.update and this.delete to write through db

The 4.x CRUD helpers also emitted and ran lifecycle hooks; `db.<model>` writes are tracked and throw on failure.

- [ ] `apps/api/src/services/chat/index.ts:255` 4.x CRUD helper this.create: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.chat.create(...) instead (frames follow the tracked write; hooks do not run; db.create throws on failure)
- [ ] `apps/api/src/services/chat/index.ts:275` 4.x CRUD helper this.update: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.chat.update(...) instead (frames follow the tracked write; hooks do not run; 4.x returned null for a missing row where db.update throws NOT_FOUND)
- [ ] `apps/api/src/services/chat/index.ts:286` 4.x CRUD helper this.delete: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.chat.delete(...) instead (frames follow the tracked write; hooks do not run; 4.x returned false for a missing row where db.delete throws NOT_FOUND)
- [ ] `apps/api/src/services/document/index.ts:168` 4.x CRUD helper this.update: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.document.update(...) instead (frames follow the tracked write; hooks do not run; 4.x returned null for a missing row where db.update throws NOT_FOUND)
- [ ] `apps/api/src/services/document/index.ts:178` 4.x CRUD helper this.delete: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.document.delete(...) instead (frames follow the tracked write; hooks do not run; 4.x returned false for a missing row where db.delete throws NOT_FOUND)
- [ ] `apps/api/src/services/message/index.ts:165` 4.x CRUD helper this.create: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.message.create(...) instead (frames follow the tracked write; hooks do not run; db.create throws on failure)
- [ ] `apps/api/src/services/message/index.ts:182` 4.x CRUD helper this.delete: it also emitted the entity and collection deltas and ran the lifecycle hooks. Write db.message.delete(...) instead (frames follow the tracked write; hooks do not run; 4.x returned false for a missing row where db.delete throws NOT_FOUND)

## Lifecycle hooks

Hooks ran only inside the CRUD helpers; move their work into the methods that write.

- [ ] `apps/api/src/services/message/index.ts:132` 4.x lifecycle hook, run only by this.create: move what it does into the methods that create rows (or affects, for rows of other services), then delete it
- [ ] `apps/api/src/services/message/index.ts:141` 4.x lifecycle hook, run only by this.delete: move what it does into the methods that delete rows (or affects), then delete it

## installAdminMethods to replace with the admin kit

`admin.contract({ entity })` and `admin.handlers(contract, options)`.

- [ ] `apps/api/src/services/chat/index.ts:33` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, { displayName, hiddenFields, fieldOverrides }) in methods), then delete this; it is no longer used
- [ ] `apps/api/src/services/definition/index.ts:80` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
- [ ] `apps/api/src/services/document/index.ts:18` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, { displayName, hiddenFields, fieldOverrides }) in methods), then delete this; it is no longer used
- [ ] `apps/api/src/services/game/index.ts:206` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
- [ ] `apps/api/src/services/message/index.ts:36` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, { displayName, hiddenFields, fieldOverrides }) in methods), then delete this; it is no longer used
- [ ] `apps/api/src/services/push-subscription/index.ts:180` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
- [ ] `apps/api/src/services/user/index.ts:19` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, { displayName, hiddenFields, fieldOverrides }) in methods), then delete this; it is no longer used

## Methods a kit implements

Methods of a kit method's shape (`get`, `list`, `create`, `getTask`, ...): the kit checks access on every row it touches, pages and stays live (lint: `prefer-kit`). Replace each with its kit, or keep it with a `// quickdraw: hand-written because <reason>` comment above it.

- [ ] `apps/api/src/services/chat/index.ts:250` createChat has the shape of the read/write kit's create, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/chat/index.ts:281` deleteChat has the shape of the read/write kit's delete, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/chat/index.ts:327` inviteByName has the shape of the sharing kit's inviteByName, which checks access on every row it touches, pages and stays live: replace it with sharing.handlers (sharing.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/definition/index.ts:113` listDefinitions has the shape of the read/write kit's list, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/definition/index.ts:124` getDefinition has the shape of the read/write kit's get, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/document/index.ts:128` createDocument has the shape of the read/write kit's create, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/document/index.ts:147` getDocument has the shape of the read/write kit's get, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/document/index.ts:159` updateDocument has the shape of the read/write kit's update, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/document/index.ts:173` deleteDocument has the shape of the read/write kit's delete, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/message/index.ts:178` deleteMessage has the shape of the read/write kit's delete, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/user/index.ts:121` updateUser has the shape of the read/write kit's update, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)

## Service instance state and the 4.x context

A service is an object now: no constructor, no fields, no `this`; handlers read `ctx.principal`.

- [ ] `apps/api/src/services/chat/index.ts:200` the 4.x service logger: take a Logger argument, or log from the handler that calls this with ctx.log
- [ ] `apps/api/src/services/definition/index.ts:19` 4.x constructor code of DefinitionService: a service object has no constructor; move what still matters to module scope, a job or the server's start-up, then delete this function
- [ ] `apps/api/src/services/definition/index.ts:26` this.changedListeners was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/definition/index.ts:32` this.changedListeners was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/definition/index.ts:60` overrode the 4.x BaseService method adminCreate, which 5.0 does not have: keep what it still needs elsewhere, then delete it
- [ ] `apps/api/src/services/definition/index.ts:62` calls the 4.x base class, which 5.0 does not have: keep what this code still needs without it
- [ ] `apps/api/src/services/definition/index.ts:68` overrode the 4.x BaseService method adminUpdate, which 5.0 does not have: keep what it still needs elsewhere, then delete it
- [ ] `apps/api/src/services/definition/index.ts:73` calls the 4.x base class, which 5.0 does not have: keep what this code still needs without it
- [ ] `apps/api/src/services/game/index.ts:37` 4.x constructor code of GameService: a service object has no constructor; move what still matters to module scope, a job or the server's start-up, then delete this function
- [ ] `apps/api/src/services/game/index.ts:45` this.loop was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:50` this.loop was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:71` overrode the 4.x BaseService method unsubscribeSocket, which 5.0 does not have: keep what it still needs elsewhere, then delete it
- [ ] `apps/api/src/services/game/index.ts:73` calls the 4.x base class, which 5.0 does not have: keep what this code still needs without it
- [ ] `apps/api/src/services/game/index.ts:78` overrode the 4.x BaseService method unsubscribe, which 5.0 does not have: keep what it still needs elsewhere, then delete it
- [ ] `apps/api/src/services/game/index.ts:80` calls the 4.x base class, which 5.0 does not have: keep what this code still needs without it
- [ ] `apps/api/src/services/game/index.ts:86` this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:88` this.subscribers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:96` this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:98` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:122` the 4.x service logger: take a Logger argument, or log from the handler that calls this with ctx.log
- [ ] `apps/api/src/services/game/index.ts:137` this.io was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:141` this.subscribers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:145` this.subscribers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:165` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:170` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:174` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:175` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:188` 4.x channel: declare it in the contract's channels ({ payload, ratePerSecond, burst, requires }; requireRoom becomes requires: { room }) and handle it in defineService's channels
- [ ] `apps/api/src/services/game/index.ts:193` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:255` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:257` this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:282` ctx.socketId was a field of 4.x's method context (userId, socketId, serviceAccess); 5.0's ctx has principal, requestId, log and transport
- [ ] `apps/api/src/services/game/index.ts:293` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:303` this.playingUsers was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/game/index.ts:305` this.sim was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/message/index.ts:134` this.chatService was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/message/index.ts:137` this.pushService was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/message/index.ts:143` this.chatService was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/push-subscription/index.ts:68` 4.x constructor code of PushService: a service object has no constructor; move what still matters to module scope, a job or the server's start-up, then delete this function
- [ ] `apps/api/src/services/push-subscription/index.ts:94` this.transport was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/push-subscription/index.ts:135` this.transport was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
- [ ] `apps/api/src/services/push-subscription/index.ts:172` this.isUserOnline was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services

## Client

Hook calls now go through the typed client (`qd.<service>.<member>`); these need a decision.

- [ ] `apps/web/src/app/chats/[chatId]/page.tsx:28` error is a QuickdrawError now (4.x: the message string): read error.message, or error.code (FORBIDDEN, NOT_FOUND, ...) to tell failures apart
- [ ] `apps/web/src/components/admin/AdminCreateModal.tsx:81` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/components/admin/AdminEntitySidebar.tsx:73` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/components/admin/AdminEntitySidebar.tsx:101` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/components/admin/AdminEntitySidebar.tsx:106` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/components/admin/UserServiceAccessEditor.tsx:51` userService has no method "adminUpdate" in its contract
- [ ] `apps/web/src/components/chat/ChatSidebar.tsx:152` onError receives a QuickdrawError now (4.x passed the message string): read error.message or error.code
- [ ] `apps/web/src/components/chat/ChatSidebar.tsx:314` invalidateOn is gone: give the query a watch in its contract entry (it is fetched again when that collection scope changes), or read a collection
- [ ] `apps/web/src/components/chat/ChatWindow.tsx:33` declare the collection "byChat" in the messageService contract (see the [collection] marker where 4.x defined it): qd.messageService.byChat does not exist until then, and the cast to the 4.x item type stands in for its type; delete the cast once it is declared
- [ ] `apps/web/src/components/chat/ChatWindow.tsx:34` compare is gone: items follow the contract collection's order (put the sort there)
- [ ] `apps/web/src/components/discord/DiscordActivityShell.tsx:111` 4.x QuickdrawProvider props (serverUrl, socketPath, authToken, autoConnect): 5.0 takes client={qd} (lib/quickdraw), url, auth and socketOptions
- [ ] `apps/web/src/components/game/GameChatOverlay.tsx:38` room events: declare them in the contract's events and listen with qd.<service>.<event>.useEvent(handler)
- [ ] `apps/web/src/components/game/GameHud.tsx:30` room events: declare them in the contract's events and listen with qd.<service>.<event>.useEvent(handler)
- [ ] `apps/web/src/components/game/GameSurface.tsx:112` invalidateOn is gone: give the query a watch in its contract entry (it is fetched again when that collection scope changes), or read a collection
- [ ] `apps/web/src/components/game/GameSurface.tsx:119` invalidateOn is gone: give the query a watch in its contract entry (it is fetched again when that collection scope changes), or read a collection
- [ ] `apps/web/src/components/game/GameSurface.tsx:134` room events: declare them in the contract's events and listen with qd.<service>.<event>.useEvent(handler)
- [ ] `apps/web/src/hooks/useAdminList.ts:71` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/hooks/useAdminList.ts:100` manual refetch: live data, watch and the invalidation coordinator keep quickdraw queries current; delete it, or give the query a watch
- [ ] `apps/web/src/hooks/useAdminMeta.ts:33` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/hooks/useAdminServices.ts:83` this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
- [ ] `apps/web/src/hooks/useMyChats.ts:29` declare the collection "myChats" in the chatService contract (see the [collection] marker where 4.x defined it): qd.chatService.myChats does not exist until then, and the cast to the 4.x item type stands in for its type; delete the cast once it is declared
- [ ] `apps/web/src/hooks/useMyChats.ts:30` compare is gone: items follow the contract collection's order (put the sort there)
- [ ] `apps/web/src/providers/index.tsx:46` 4.x QuickdrawProvider props (serverUrl, autoConnect): 5.0 takes client={qd} (lib/quickdraw), url, auth and socketOptions
- [ ] `apps/web/src/stories/decorators.tsx:46` 4.x QuickdrawProvider props (serverUrl, autoConnect): 5.0 takes client={qd} (lib/quickdraw), url, auth and socketOptions

## Server wiring and other 4.x APIs

What lint's `no-v4-api` also reports, each with its replacement: the server set-up, room helpers, removed types.

- [ ] `apps/api/src/__tests__/services/chat.int.test.ts:3` 4.x API CollectionSnapshotResponse (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/__tests__/services/collections.int.test.ts:14` 4.x API CollectionSnapshotResponse (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:150` DefinitionService is imported dynamically here, and 5.0 has no class: import the service object definitionService (pass it in qd.createServer({ services: [...] })), or call it through qd.caller(principal)
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:152` GameService is imported dynamically here, and 5.0 has no class: import the service object gameService (pass it in qd.createServer({ services: [...] })), or call it through qd.caller(principal)
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:154` the 4.x service was constructed here (new DefinitionService(...)): it is the object definitionService now
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:156` the 4.x service was constructed here (new GameService(...)): it is the object gameService now
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:159` definitionService is a 4.x DefinitionService instance, whose members (onChanged here) the service object definitionService does not have: call a contract method through qd.caller(principal).definitionService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:162` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:167` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/definition.int.test.ts:185` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:90` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:132` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:153` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:174` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:197` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:207` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:213` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:291` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:298` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:302` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:331` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:338` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:347` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:362` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:368` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:381` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:386` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:446` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:454` gameService is a 4.x GameService instance, whose members (loop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/game.int.test.ts:466` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/__tests__/services/message.int.test.ts:3` 4.x API CollectionSnapshotResponse (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/__tests__/services/push.int.test.ts:248` the 4.x service was constructed here (new PushService(...)): it is the object pushServiceDef now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/__tests__/utils/server.ts:2` 4.x API createQuickdrawServer (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/__tests__/utils/socket.ts:10` "@fitzzero/quickdraw-core/server/testing" was removed in 5.0; lint's no-v4-api names what replaces it
- [ ] `apps/api/src/auth/discord-activity.ts:24` 4.x API OAuthTokenResponse (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/discord-activity.ts:26` 4.x API setSessionCookie (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/discord.ts:2` 4.x API createOAuthURL, discordProvider, exchangeOAuthCode, getDiscordAvatarUrl, OAuthConfig (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/google.ts:2` 4.x API createOAuthURL, exchangeOAuthCode, googleProvider, OAuthConfig (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/guest.ts:15` 4.x API setSessionCookie (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/middleware.ts:1` 4.x API QuickdrawIdentity (removed) and SESSION_COOKIE, QuickdrawSocket (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/mock.ts:2` 4.x API createMockOAuthProvider, createOAuthURL, exchangeOAuthCode, isMockOAuthEnabled, registerMockOAuthProvider, MockOAuthUser, OAuthConfig, OAuthProvider (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/mock.ts:13` 4.x API GoogleUser (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/oauth-callback.ts:3` 4.x API setSessionCookie, OAuthTokenResponse (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/rest-middleware.ts:2` 4.x API createRequireAuth (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/auth/routes.ts:2` 4.x API clearSessionCookie, extractBearerOrCookieToken (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/bench/server.ts:16` 4.x API createQuickdrawServer (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/bench/server.ts:127` gameService is a 4.x GameService instance, whose members (startLoop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/bench/server.ts:136` gameService is a 4.x GameService instance, whose members (stopLoop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/index.ts:15` 4.x API ServiceRegistry (removed) and validateRedirectOrigin, QuickdrawSocket (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/index.ts:30` 4.x API CHANNEL_EVENT_PREFIX (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/index.ts:177` gameService is a 4.x GameService instance, whose members (startLoop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/index.ts:179` gameService is a 4.x GameService instance, whose members (stopLoop here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/index.ts:183` definitionService is a 4.x DefinitionService instance, whose members (onChanged here) the service object definitionService does not have: call a contract method through qd.caller(principal).definitionService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/index.ts:186` gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/mcp-bootstrap.ts:11` 4.x API bootstrapMcpServer (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/mcp-server.ts:13` 4.x API McpRegistry, createMcpStdioServer (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/services/build-services.ts:70` the 4.x service was constructed here (new ChatService(...)): it is the object chatServiceDef now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/build-services.ts:72` the 4.x service was constructed here (new PushService(...)): it is the object pushServiceDef now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/build-services.ts:76` the 4.x service was constructed here (new UserService(...)): it is the object userService now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/build-services.ts:79` the 4.x service was constructed here (new MessageService(...)): it is the object messageService now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/build-services.ts:81` the 4.x service was constructed here (new DocumentService(...)): it is the object documentService now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/build-services.ts:85` the 4.x service was constructed here (new GameService(...)): it is the object gameService now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/build-services.ts:87` the 4.x service was constructed here (new DefinitionService(...)): it is the object definitionService now; pass it in qd.createServer({ services: [...] })
- [ ] `apps/api/src/services/chat/index.ts:5` 4.x API CollectionSnapshotPage (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/services/document/index.ts:3` 4.x API QuickdrawSocket (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/services/game/index.ts:15` 4.x API QuickdrawSocket (moved): lint's no-v4-api names each replacement
- [ ] `apps/api/src/services/message/index.ts:4` 4.x API CollectionSnapshotPage (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/services/push-subscription/rest.ts:44` pushService is a 4.x PushService instance, whose members (resubscribe here) the service object pushService does not have: call a contract method through qd.caller(principal).pushService.<method>(input), and move other logic into a module of its own
- [ ] `apps/api/src/services/shared/guards.ts:1` 4.x API ServiceMethodContext (removed): lint's no-v4-api names each replacement
- [ ] `apps/api/src/services/user/index.ts:3` 4.x API QuickdrawSocket (moved): lint's no-v4-api names each replacement
- [ ] `apps/web/src/components/admin/AdminCreateModal.tsx:22` 4.x API useService (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/components/admin/AdminEntitySidebar.tsx:26` 4.x API useService, useServiceQuery (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/components/chat/ChatSidebar.tsx:26` 4.x API SocketTextField (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/components/chat/ChatWindow.stories.tsx:4` "@fitzzero/quickdraw-core/client/testing" was removed in 5.0; lint's no-v4-api names what replaces it
- [ ] `apps/web/src/components/chat/MessageInput.stories.tsx:2` "@fitzzero/quickdraw-core/client/testing" was removed in 5.0; lint's no-v4-api names what replaces it
- [ ] `apps/web/src/components/user/UserAvatar.stories.tsx:3` "@fitzzero/quickdraw-core/client/testing" was removed in 5.0; lint's no-v4-api names what replaces it
- [ ] `apps/web/src/hooks/index.ts:3` 4.x API useRoomEvents (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/hooks/useAdminList.ts:4` 4.x API useServiceQuery (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/hooks/useAdminList.ts:6` 4.x API AdminListResponse (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/hooks/useAdminMeta.ts:3` 4.x API useServiceQuery (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/hooks/useAdminServices.ts:4` 4.x API useServiceQuery (removed): lint's no-v4-api names each replacement
- [ ] `apps/web/src/providers/index.tsx:11` 4.x API useQuickdrawSocket (removed): lint's no-v4-api names each replacement
