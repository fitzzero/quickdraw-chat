---
paths:
  - "apps/web/**/*.stories.tsx"
  - "apps/web/.storybook/**"
  - "apps/web/src/stories/**"
---

# Storybook

Full guide: `docs/storybook.md`. Run with `bun run storybook` (port 6106);
`bun run build-storybook` is the CI gate — a story that stops compiling fails
the build.

## Story rules

- Co-locate: `src/components/<domain>/Foo.stories.tsx` with
  `title: "<Domain>/Foo"` mirroring the folder. Never park stories in a
  separate stories tree.
- Export the component's Props type (`export interface FooProps`) and use
  `satisfies Meta<typeof Foo>`.
- First export is `Default`; state variants (`Loading`, `Empty`, `Disabled`,
  error) follow.
- Text args are realistic English strings. Components resolve their own copy
  from `src/messages/en.json` via the global intl decorator — never pass raw
  translation keys as args.
- Lint rules apply in stories: no raw strings in `Typography`/`Button`/
  `Tooltip` support JSX; `sx` theme tokens, not hex.

## Context and mocking

- NEVER import `src/providers/index.tsx` or `src/providers/ThemeProvider.tsx`
  in stories or Storybook config — the first mounts the real
  `QuickdrawProvider`, the second is Next-runtime-only
  (`useServerInsertedHTML`). The global decorator in `.storybook/preview.tsx`
  already provides theme + intl + toasts + the story's quickdraw session.
- Components calling `useLayout()`: add `withLayoutProvider` from
  `src/stories/decorators.tsx`.
- Components on quickdraw (`qd.<service>.<member>` hooks, `useQuickdraw()`)
  render over `createMockClient`: Storybook aliases `src/lib/quickdraw.ts` to
  `src/stories/quickdraw.tsx`, and the global decorator renders every story
  inside `qd.$Provider`, where the real `useQuickdraw()` reads the mock's
  session. Import `qd` from there and set what the hooks show in the story's
  `beforeEach` (`qd.<service>.<collection>.mockScope`,
  `qd.<service>.useEntity.mockRow`/`mockError`, `qd.<service>.<method>.mockResolvedValue`);
  give each story its own ids (a docs page renders them together); what no
  story sets stays loading. `parameters.quickdraw.session` (`userId`,
  `serviceAccess`, `isConnected`, `isKnown`) sets who the story renders as.
- Route-dependent components: mock the pathname with
  `parameters: { nextjs: { navigation: { pathname: "/..." } } }`.
- Do not add ports or boot steps for Storybook to `turbo dev`, pod boot
  scripts, or the devcontainer — it starts on demand only.
