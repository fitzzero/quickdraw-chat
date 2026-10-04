# quickdraw 5.0 migration report

Written by `@fitzzero/quickdraw-codemod` from the `// quickdraw-migrate: review` markers in the code; running the codemod again rewrites it from the markers that remain. Work through the sections in order (contracts, access, emits, client), delete each marker once its item is done, and see the migration guide (`MIGRATION.md`, shipped in `@fitzzero/quickdraw-codemod`) for each kind of item. Then run lint (`no-v4-api` names every 4.x API left, `no-todo-schema` every placeholder) and the typecheck.

52 items in 23 files.

| Section                                                        | Items |
| -------------------------------------------------------------- | ----: |
| Access                                                         |     4 |
| Access overrides to turn into a policy                         |     2 |
| toDto and protected fields to turn into projections and fields |     1 |
| Hand emits to delete                                           |     1 |
| installAdminMethods to replace with the admin kit              |     2 |
| Methods a kit implements                                       |     2 |
| Service instance state and the 4.x context                     |     4 |
| Client                                                         |    24 |
| Server wiring and other 4.x APIs                               |    12 |

## Access

The forms admit exactly the callers 4.x admitted, and `jsonAcl("acl")` the rows 4.x's `hasEntryACL` did, but for a user listed twice in a row's list (marked). "Read" without a row id was open to every signed-in user; decide whether that was meant. A method whose input has `id` under a form that checks no row ("public", say) carries `rowless: true` (marked): 5.0 refuses to define that shape on a service with an access policy without it, and it keeps the 4.x callers.

- [ ] `apps/api/src/services/game/index.ts:83` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:118` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:127` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
- [ ] `apps/api/src/services/game/index.ts:150` "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant

## Access overrides to turn into a policy

4.x decided row access in overridden methods; 5.0 decides it in the service's `access` policy, for every surface at once.

- [ ] `apps/api/src/services/game/index.ts:29` 4.x access override: port it to the service's access policy (owner, jsonAcl, members, inherit, anyOf or resolver), then delete this function
- [ ] `apps/api/src/services/game/index.ts:77` 4.x decided row access in checkAccess (now functions in this file): port them to a policy (owner, jsonAcl, members, inherit, anyOf or resolver). Until then this policy grants no row, so only service grants pass

## toDto and protected fields to turn into projections and fields

Subscribers receive the contract's projections, built from rows, with field levels from the contract's `fields`.

- [ ] `apps/api/src/services/definition/index.ts:26` 4.x toDto: subscribers now receive the contract entity's keys, projected from the row (dates as ISO strings); fold computed fields into a projection's select and map, then delete this function

## Hand emits to delete

5.0 sends entity frames and collection deltas from tracked writes; room events become contract events.

- [ ] `apps/api/src/services/game/runtime.ts:44` room event: declare it in the contract's events and send it with ctx.rooms.emit(room, contract, event, payload)

## installAdminMethods to replace with the admin kit

`admin.contract({ entity })` and `admin.handlers(contract, options)`.

- [ ] `apps/api/src/services/definition/index.ts:55` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
- [ ] `apps/api/src/services/game/index.ts:22` installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)

## Methods a kit implements

Methods of a kit method's shape (`get`, `list`, `create`, `getTask`, ...): the kit checks access on every row it touches, pages and stays live (lint: `prefer-kit`). Replace each with its kit, or keep it with a `// quickdraw: hand-written because <reason>` comment above it.

- [ ] `apps/api/src/services/definition/index.ts:71` listDefinitions has the shape of the read/write kit's list, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)
- [ ] `apps/api/src/services/definition/index.ts:84` getDefinition has the shape of the read/write kit's get, which checks access on every row it touches, pages and stays live: replace it with crud.handlers (crud.contract in the contract), or keep it with a "// quickdraw: hand-written because <reason>" comment above it (lint: prefer-kit)

## Service instance state and the 4.x context

A service is an object now: no constructor, no fields, no `this`; handlers read `ctx.principal`.

- [ ] `apps/api/src/services/definition/index.ts:53` 4.x overrode adminCreate and adminUpdate to call notifyChanged(row) after each admin write, so the game sim hot-reloads tunables: give the admin kit's writes the same hook
- [ ] `apps/api/src/services/game/index.ts:17` 4.x channel: declare it in the contract's channels ({ payload, ratePerSecond, burst, requires }; requireRoom becomes requires: { room }) and handle it in defineService's channels
- [ ] `apps/api/src/services/game/index.ts:25` 4.x overrode unsubscribeSocket(socket) (a disconnect) and unsubscribe(entryId, socket) (leaving the world's row) to call maybeRemovePlayer(socket.userId) after the base class removed the socket: run it wherever a player's last socket leaves the world
- [ ] `apps/api/src/services/game/index.ts:112` ctx.socketId was a field of 4.x's method context (userId, socketId, serviceAccess); 5.0's ctx has principal, requestId, log and transport

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
