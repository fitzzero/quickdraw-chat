"use client";

import * as React from "react";
// ── quickdraw-game:start ──
import { usePathname } from "next/navigation";
// ── quickdraw-game:end ──
import { QuickdrawProvider } from "@fitzzero/quickdraw-core/client";
import { ThemeProvider } from "./ThemeProvider";
import { LayoutProvider } from "./LayoutProvider";
import { IntlProvider } from "./IntlProvider";
import { ToastProvider } from "./ToastProvider";
import { ClientShell } from "../components/layout";
import { useServiceWorker } from "../hooks/useServiceWorker";
import { qd } from "../lib/quickdraw";

interface ProvidersProps {
  children: React.ReactNode;
}

const SERVER_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Providers({ children }: ProvidersProps): React.ReactElement {
  // PWA: register the service worker (installability + web push)
  useServiceWorker(SERVER_URL);

  // ── quickdraw-game:start ──
  const pathname = usePathname();

  // The Discord Activity route runs inside Discord's sandboxed iframe: no
  // app chrome, and its own QuickdrawProvider that connects through the
  // /.proxy path with token auth (third-party cookies don't survive there).
  if (pathname?.startsWith("/discord")) {
    return (
      <ThemeProvider>
        <ToastProvider>
          <IntlProvider>{children}</IntlProvider>
        </ToastProvider>
      </ThemeProvider>
    );
  }
  // ── quickdraw-game:end ──

  // Auth is cookie-based: the socket's handshake carries the httpOnly session
  // cookie (the connection sends credentials by default), so there is no
  // `auth` prop, and the server's hello names the user (useQuickdraw().userId).
  // A hello naming another user empties everything quickdraw cached, and
  // after a reconnect the watched and stale queries refetch within the
  // default reconnectJitterMs (2 s); live rows and collections resume by
  // revision at once.
  return (
    <ThemeProvider>
      <ToastProvider>
        <IntlProvider>
          <QuickdrawProvider client={qd} url={SERVER_URL}>
            <LayoutProvider>
              <ClientShell>{children}</ClientShell>
            </LayoutProvider>
          </QuickdrawProvider>
        </IntlProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

// Re-export layout hooks
export { useLayout, useRightSidebar, usePageTitle } from "./LayoutProvider";

// Re-export i18n hooks
export { useLocale } from "./IntlProvider";

// Re-export toast hook
export { useToast } from "./ToastProvider";
