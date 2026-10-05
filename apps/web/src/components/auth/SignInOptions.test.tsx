// What the login page offers for each answer of GET /auth/providers: a
// button per sign-in the API serves and none it does not, the demo-user
// picker only with the mock, and the loading, failed and nothing-served
// states.

import * as React from "react";
import { fireEvent, render, screen, type RenderResult } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SignInProvider } from "../../lib/auth";
import { IntlProvider } from "../../providers/IntlProvider";
import { SignInOptions, type SignInOptionsProps } from "./SignInOptions";

const GOOGLE: SignInProvider = { id: "google", kind: "oauth" };
const DISCORD: SignInProvider = { id: "discord", kind: "oauth" };
const MOCK: SignInProvider = { id: "mock", kind: "mock" };
const GUEST: SignInProvider = { id: "guest", kind: "guest" };

function renderOptions(props: SignInOptionsProps): RenderResult {
  return render(
    <IntlProvider>
      <SignInOptions {...props} />
    </IntlProvider>,
  );
}

/** The buttons' labels, top to bottom. */
function buttons(): string[] {
  return screen.getAllByRole("button").map((button) => button.textContent ?? "");
}

describe("SignInOptions", () => {
  it("offers every OAuth provider served, then the demo-user picker", () => {
    renderOptions({ providers: [GOOGLE, DISCORD, { id: "github", kind: "oauth" }, MOCK, GUEST] });
    expect(buttons()).toEqual([
      "Continue with Google",
      "Continue with Discord",
      "Continue with Github",
      "Continue as demo user",
    ]);
    expect(screen.getByText("or")).toBeTruthy();
    expect(screen.getByText(/Development only/)).toBeTruthy();
  });

  it("offers the one provider served, and no other", () => {
    renderOptions({ providers: [GOOGLE] });
    expect(buttons()).toEqual(["Continue with Google"]);
    expect(screen.queryByText(/Development only/)).toBeNull();
  });

  it("offers the demo-user picker alone when the mock is all the API serves", () => {
    // a hosted development instance without Google or Discord credentials
    renderOptions({ providers: [MOCK, GUEST] });
    expect(buttons()).toEqual(["Continue as demo user"]);
    expect(screen.queryByText("or")).toBeNull();
  });

  it("says so when the API serves nothing to sign in with (a guest is not offered here)", () => {
    renderOptions({ providers: [GUEST] });
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getByText("No way to sign in yet")).toBeTruthy();
    expect(screen.getByText(/no sign-in provider configured/)).toBeTruthy();
  });

  it("waits while the list loads, offering nothing", () => {
    renderOptions({});
    expect(screen.getByRole("progressbar", { name: "Loading the ways to sign in" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("says when the API could not be asked, with a retry instead of buttons that could 404", () => {
    const onRetry = vi.fn();
    const view = renderOptions({ failed: true, onRetry });
    expect(screen.getByText(/Couldn't reach the server/)).toBeTruthy();
    expect(buttons()).toEqual(["Try again"]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();

    // the retry waits while it asks again
    view.rerender(
      <IntlProvider>
        <SignInOptions failed onRetry={onRetry} retrying />
      </IntlProvider>,
    );
    expect(screen.getByRole("button", { name: "Try again" }).hasAttribute("disabled")).toBe(true);
  });
});
