"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AppLayout } from "./AppLayout";

interface ClientShellProps {
  children: React.ReactNode;
}

/** Routes that should NOT have the AppLayout (auth pages) */
const EXCLUDED_ROUTES = ["/auth"];

/**
 * Client component that conditionally wraps children in AppLayout.
 * Auth pages render without the app shell for a cleaner login experience.
 */
export function ClientShell({ children }: ClientShellProps): React.ReactElement {
  const pathname = usePathname();

  // Check if current route should be excluded from AppLayout
  const shouldExclude = EXCLUDED_ROUTES.some((route) => pathname.startsWith(route));

  if (shouldExclude) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
