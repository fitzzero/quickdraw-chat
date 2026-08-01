"use client";

import * as React from "react";
// ── quickdraw-game:start ──
import { usePathname } from "next/navigation";
// ── quickdraw-game:end ──
import { ThemeProvider } from "./ThemeProvider";
import { LayoutProvider } from "./LayoutProvider";
import { IntlProvider } from "./IntlProvider";
import { ToastProvider } from "./ToastProvider";
import { QuickdrawProvider, useQuickdrawSocket } from "@fitzzero/quickdraw-core/client";
import { ClientShell } from "../components/layout";
import { useServiceWorker } from "../hooks/useServiceWorker";

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

  // Auth is cookie-based: the socket handshake carries the httpOnly session
  // cookie (QuickdrawProvider defaults withCredentials: true) and the server
  // answers with auth:info — no client-side token handling required.
  return (
    <ThemeProvider>
      <ToastProvider>
        <IntlProvider>
          <QuickdrawProvider serverUrl={SERVER_URL} autoConnect>
            <LayoutProvider>
              <ClientShell>{children}</ClientShell>
            </LayoutProvider>
          </QuickdrawProvider>
        </IntlProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

// Re-export useQuickdrawSocket as useSocket for backward compatibility
export { useQuickdrawSocket as useSocket };

// Re-export layout hooks
export { useLayout, useRightSidebar, usePageTitle } from "./LayoutProvider";

// Re-export i18n hooks
export { useLocale } from "./IntlProvider";

// Re-export toast hook
export { useToast } from "./ToastProvider";
