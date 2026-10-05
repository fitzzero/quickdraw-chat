// The login page asks the API which sign-ins it serves (GET /auth/providers)
// and offers those: on a hosted development instance with only the mock, the
// demo user alone; when the request fails, a retry and no button that would
// answer 404.

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../app/auth/login/page";
import { IntlProvider } from "../providers/IntlProvider";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

/** Where the page asks: the API's URL, as the bundle has it. */
const PROVIDERS_URL = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/auth/providers`;

/** The login page under its own cache (the app's is QuickdrawProvider's), retrying at once. */
function renderLoginPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider>
        <LoginPage />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the login page", () => {
  it("offers what the API serves: the demo user alone where it has no Google or Discord credentials", async () => {
    const fetchProviders = vi.fn(async (_url: string) =>
      Response.json({
        providers: [
          { id: "mock", kind: "mock" },
          { id: "guest", kind: "guest" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchProviders);
    renderLoginPage();

    expect(await screen.findByRole("button", { name: "Continue as demo user" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Discord" })).toBeNull();
    expect(fetchProviders).toHaveBeenCalledWith(PROVIDERS_URL);
  });

  it("answers a failed request with a retry, then offers the sign-ins once the API answers", async () => {
    const fetchProviders = vi.fn(
      async (_url: string) => new Response("Not Found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchProviders);
    renderLoginPage();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText(/Couldn't reach the server/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    // asked once more on its own before saying so
    expect(fetchProviders).toHaveBeenCalledTimes(2);

    fetchProviders.mockImplementation(async () =>
      Response.json({ providers: [{ id: "google", kind: "oauth" }] }),
    );
    fireEvent.click(retry);
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue as demo user" })).toBeNull();
  });

  it("treats an answer it cannot read as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "NOT_FOUND" })),
    );
    renderLoginPage();

    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
