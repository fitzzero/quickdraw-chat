import * as React from "react";

/**
 * Calls `onItem` once for each item a stream appended since the last call,
 * oldest first. `first` is true for the first item of a list that holds
 * none of the items handled before: the hook's first items, or a list a new
 * seed replaced (a new link to the host, a resubscribe); a list that still
 * holds the last item handled is news from there on.
 */
export function useNewItems<T>(
  items: readonly T[],
  onItem: (item: T, first: boolean) => void,
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
    const fresh = items.slice(at + 1);
    fresh.forEach((item, i) =>
      handle.current(item, i === 0 && (previous === undefined || replaced)),
    );
  }, [items, options.replaced]);
}
