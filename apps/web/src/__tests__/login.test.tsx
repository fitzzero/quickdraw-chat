// The login page asks the API which sign-ins it serves (the auth routes
// kit's GET /auth/providers, through the client's `authProviders()`) and
// offers those: on a hosted development instance with only the mock, the
// demo user alone; an OAuth provider by the name the API gives it; when the
// request fails, a retry and no button that would answer 404.

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import LoginPage from "../app/auth/login/page";
import { IntlProvider } from "../providers/IntlProvider";

/** `fetch`, as the page's `authProviders()` calls it. */
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

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

/** The API answering GET /auth/providers with `providers`, as the kit does. */
function serving(providers: readonly Record<string, string>[]): Mock<Fetch> {
  const fetchProviders = vi.fn<Fetch>(async () => Response.json({ providers }));
  vi.stubGlobal("fetch", fetchProviders);
  return fetchProviders;
}

/** The sign-in buttons' labels, top to bottom. */
function signInButtons(): string[] {
  return screen
    .getAllByRole("button", { name: /^Continue/ })
    .map((button) => button.textContent ?? "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the login page", () => {
  it("offers the demo user alone where the API serves only the mock", async () => {
    const fetchProviders = serving([{ id: "mock", name: "Mock", kind: "mock" }]);
    renderLoginPage();

    expect(await screen.findByRole("button", { name: "Continue as demo user" })).toBeTruthy();
    expect(signInButtons()).toEqual(["Continue as demo user"]);
    expect(fetchProviders.mock.calls[0]?.[0]).toBe(PROVIDERS_URL);
  });

  it("offers the demo user and not the guest (a guest signs in from the game) where it serves both", async () => {
    // the hosted dev instance: no Google or Discord credentials
    serving([
      { id: "mock", name: "Mock", kind: "mock" },
      { id: "guest", name: "Guest", kind: "guest" },
    ]);
    renderLoginPage();

    expect(await screen.findByRole("button", { name: "Continue as demo user" })).toBeTruthy();
    expect(signInButtons()).toEqual(["Continue as demo user"]);
  });

  it("names each OAuth provider's button as the API names it, before the demo user", async () => {
    serving([
      { id: "google", name: "Google", kind: "oauth" },
      { id: "acme", name: "Acme ID", kind: "oauth" },
      { id: "mock", name: "Mock", kind: "mock" },
    ]);
    renderLoginPage();

    expect(await screen.findByRole("button", { name: "Continue with Acme ID" })).toBeTruthy();
    expect(signInButtons()).toEqual([
      "Continue with Google",
      "Continue with Acme ID",
      "Continue as demo user",
    ]);
  });

  it("answers a failed request with a retry, then offers the sign-ins once the API answers", async () => {
    const fetchProviders = vi.fn<Fetch>(async () => new Response("Not Found", { status: 404 }));
    vi.stubGlobal("fetch", fetchProviders);
    renderLoginPage();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText(/Couldn't reach the server/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Continue/ })).toBeNull();
    // asked once more on its own before saying so
    expect(fetchProviders).toHaveBeenCalledTimes(2);

    fetchProviders.mockImplementation(async () =>
      Response.json({ providers: [{ id: "google", name: "Google", kind: "oauth" }] }),
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
