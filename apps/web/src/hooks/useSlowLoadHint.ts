"use client";

import * as React from "react";

/**
 * True once `waiting` has been continuously true for `delayMs`.
 *
 * Used to soften long waits with context (e.g. the production API scales to
 * zero, so the first visitor pays a Cloud Run cold start — see DEPLOYMENT.md).
 * The threshold means the hint never appears on a normal fast connect.
 */
export function useSlowLoadHint(waiting: boolean, delayMs = 2500): boolean {
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setSlow(true);
    }, delayMs);
    return (): void => {
      clearTimeout(timer);
    };
  }, [waiting, delayMs]);

  return slow;
}
