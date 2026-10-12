// The gate on the mock client (no server): what a page shows for each state
// of the connection the mock's session can set. A session the server ended
// (`status` "disconnected": signed out on another device, revoked, expired)
// is played against the real server in chat.int.test.tsx: the mock's session
// has no `status`.

import * as React from "react";
import { render, screen } from "@testing-library/react";
import { createMockClient } from "@fitzzero/quickdraw-core/testing/client";
import { contracts } from "@project/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "../../providers/IntlProvider";
import { AuthGate } from "./AuthGate";

// The route the gate reads
const route = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

/** The typed client's members, with stubs; signed in as Ada, connected, until a test says otherwise. */
const mock = createMockClient(contracts, { userId: "user-ada" });

function Providers({ children }: { readonly children?: React.ReactNode }): React.ReactElement {
  return (
    <IntlProvider>
      <mock.$Provider>{children}</mock.$Provider>
    </IntlProvider>
  );
}

function renderGate(): void {
  render(
    <AuthGate>
      <p>Your chats</p>
    </AuthGate>,
    { wrapper: Providers },
  );
}

beforeEach(() => {
  // a page only signed-in users see
  route.pathname = "/chats";
});

describe("AuthGate", () => {
  it("shows the page to a signed-in user", () => {
    renderGate();
    expect(screen.getByText("Your chats")).toBeTruthy();
  });

  it("asks a signed-out visitor to sign in", () => {
    mock.$session({ userId: null });
    renderGate();
    expect(screen.getByText("Sign In Required")).toBeTruthy();
    expect(screen.queryByText("Your chats")).toBeNull();
  });

  it("waits for the server's hello, showing neither the page nor the sign-in", () => {
    mock.$session({ isConnected: false, isKnown: false });
    renderGate();
    expect(screen.getByText("Connecting...")).toBeTruthy();
    expect(screen.queryByText("Your chats")).toBeNull();
    expect(screen.queryByText("Sign In Required")).toBeNull();
  });

  it("keeps the page through a reconnect, and says so", () => {
    // the hello on these credentials arrived before the socket dropped
    mock.$session({ isConnected: false, isKnown: true });
    renderGate();
    expect(screen.getByText("Your chats")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Reconnecting…");
  });

  it("shows a public page before the hello too", () => {
    route.pathname = "/";
    mock.$session({ isConnected: false, isKnown: false });
    renderGate();
    expect(screen.getByText("Your chats")).toBeTruthy();
  });
});
