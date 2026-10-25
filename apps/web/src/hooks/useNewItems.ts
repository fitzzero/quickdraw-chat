import * as React from "react";

/**
 * Calls `onItem` once for each item a stream appended since the last call,
 * oldest first: a list that still holds the last item handled is news from
 * there on; one that holds none of them (the hook's first list, or a list a
 * new seed replaced: a new link to the host, a resubscribe) is handled
 * whole, or skipped with `replaced: "skip"`.
 */
export function useNewItems<T>(
  items: readonly T[],
  onItem: (item: T) => void,
  options: { readonly replaced?: "all" | "skip" } = {},
): void {
  const last = React.useRef<T | undefined>(undefined);
  const handle = React.useRef(onItem);
  React.useEffect(() => {
    handle.current = onItem;
  });
  React.useEffect(() => {
    const previous = last.current;
    const at = previous === undefined ? -1 : items.lastIndexOf(previous);
    const replaced = previous !== undefined && at < 0;
    last.current = items.at(-1);
    if (replaced && options.replaced === "skip") return;
    for (const item of items.slice(at + 1)) handle.current(item);
  }, [items, options.replaced]);
}
