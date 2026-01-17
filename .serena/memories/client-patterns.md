# Client Patterns

## Hooks

### useServiceQuery - For READ operations

Use `useServiceQuery` for read operations (get, list, search, find). Provides automatic caching, request deduplication, and stale time management.

```typescript
import { useServiceQuery } from "../hooks";

function ChatMembersList({ chatId }: { chatId: string }) {
  const { data: members, isLoading, refetch } = useServiceQuery(
    "chatService",
    "getChatMembers",
    { chatId },
    { enabled: !!chatId }
  );

  if (isLoading) return <Skeleton />;
  return <MemberList members={members ?? []} />;
}
```

**Options:**

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Auto-fetch on mount |
| `staleTime` | 5 min | How long data stays fresh |
| `gcTime` | 10 min | Cache retention for unused data |
| `skipCache` | `false` | Force fresh fetch, bypass cache |
| `onSuccess` | - | Success callback |
| `onError` | - | Error callback |

**Returns:**

| Property | Description |
|----------|-------------|
| `data` | The cached/fetched data |
| `isLoading` | Initial load in progress |
| `isFetching` | Any fetch in progress (including background) |
| `isStale` | Data is past staleTime |
| `isSuccess` | Query has succeeded |
| `isError` | Query has errored |
| `error` | Error message if failed |
| `refetch()` | Manual refetch function |

### useService - For WRITE operations (mutations)

Use `useService` for create, update, delete operations. The hook is stable and memoized.

```typescript
import { useService } from "../hooks";

function CreateChatButton() {
  const createChat = useService("chatService", "createChat", {
    onSuccess: (data) => {
      router.push(`/chats/${data.id}`);
    },
    onError: (error) => {
      toast.error(error);
    },
  });

  return (
    <Button
      onClick={() => createChat.mutate({ title: "New Chat" })}
      disabled={createChat.isPending}
    >
      {createChat.isPending ? "Creating..." : "Create Chat"}
    </Button>
  );
}
```

### When to use which hook

| Operation | Hook | Examples |
|-----------|------|----------|
| Read | `useServiceQuery` | `getUser`, `listChats`, `search`, `getChatMembers` |
| Write | `useService` | `createChat`, `updateTitle`, `deleteChat`, `inviteByName` |

**useSubscription** - For real-time entity data:

```typescript
import { useSubscription } from "../hooks";

function ChatHeader({ chatId }: { chatId: string }) {
  const { data: chat, isLoading, error } = useSubscription("chatService", chatId);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorMessage error={error} />;
  if (!chat) return <NotFound />;

  return <Typography>{chat.title}</Typography>;
}
```

## Socket Context

Access socket state via `useSocket`:

```typescript
import { useSocket } from "../providers";

function ConnectionStatus() {
  const { isConnected, userId, serviceAccess } = useSocket();

  // Check permissions
  const isAdmin = serviceAccess.chatService === "Admin";
}
```

## Component Structure

```
src/
├── components/
│   ├── chat/           # Feature-specific components
│   ├── layout/         # App layout components
│   ├── feedback/       # LoginRequired, NoPermission, NotFound
│   └── user/           # User-related components
├── hooks/
│   ├── useService.ts
│   ├── useSubscription.ts
│   ├── useIsMobile.ts
│   └── index.ts
├── lib/
│   └── navigation.ts   # Typed route config
├── providers/
│   ├── LayoutProvider.tsx
│   ├── ThemeProvider.tsx
│   └── index.tsx
```

## Layout & Containers

- Pages render inside `AppLayout` which provides left sidebar, appbar, and optional right sidebar
- Prefer `Stack` for row/column layouts over hardcoding `Box` flex props
- Reserve `Grid` for multi-row/column responsive layouts
- Avoid nested `Container` components

## Styling

**Use MUI's sx prop** for component styling:

```typescript
<Box
  sx={{
    p: 2,
    borderRadius: 2,
    bgcolor: "background.paper",
    "&:hover": { bgcolor: "action.hover" },
  }}
>
```

**Use theme variables** - no hardcoded hex colors:

```typescript
sx={{
  color: "primary.main",
  bgcolor: "background.default",
  borderColor: "divider",
}}
```

**Use theme.spacing** - avoid hardcoded pixel values:

```typescript
sx={{ p: 2, mt: 1, gap: 2 }}  // Good - uses theme spacing
sx={{ padding: "16px" }}       // Avoid
```

## Responsiveness

- Use `useIsMobile()` hook for responsive behavior (breakpoint: md = 900px)
- Desktop: permanent sidebars
- Mobile: SwipeableDrawer for navigation
- Prefer `sx` responsive values over inline media queries:

```typescript
sx={{
  width: { xs: "100%", md: 280 },
  display: { xs: "none", md: "block" },
}}
```

## Navigation

- Drive nav from typed route config in `lib/navigation.ts`
- Use `next/link` via `ListItemButton component={Link}`
- Indicate selected state via `usePathname()`
- Routes can specify `requireAuth: true` for protected pages

## Component Guidelines

- Keep components under 500 lines; extract subcomponents
- Avoid bespoke CSS; rely on MUI props and centralized theme overrides
- Use `rem` units for font sizes in theme

## Socket Input Components

For socket-synced inputs from `@quickdraw/core/client`:

- `SocketTextField` - Text input with debounce
- `SocketCheckbox` - Boolean toggle
- `SocketSelect` - Select dropdown
- `SocketSlider` - Range input
- `SocketSwitch` - Toggle switch

Usage:

```typescript
<SocketTextField
  state={entityData}
  update={updateEntity}
  property="title"
  label="Title"
  commitMode="blur"  // Prefer blur for text to reduce chatter
  fullWidth
/>
```

## Type Safety

**Service method types** come from `@project/shared`:

```typescript
import type { ServiceMethodsMap, ChatServiceMethods } from "@project/shared";

// Type is inferred automatically
const createChat = useService("chatService", "createChat");
// createChat.mutate expects: { title: string; members?: ... }
// createChat.data is: { id: string } | undefined
```

## Error Handling

**Hook-level:**

```typescript
const mutation = useService("chatService", "createChat", {
  onError: (error) => {
    toast.error(error);
  },
});
```

**Component-level:**

```typescript
if (mutation.isError) {
  return <Alert severity="error">{mutation.error}</Alert>;
}
```

**403 errors** - Handle at page level:

```typescript
if (error?.code === 403) {
  return <NoPermission message="You don't have access to this chat" />;
}
```

## Loading States

Use MUI components:

```typescript
if (isLoading) {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
      <CircularProgress />
    </Box>
  );
}
```
