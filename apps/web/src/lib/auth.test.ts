// sessionEnded(): which states of the connection the web shows as signed
// out (AuthGate, UserMenu, the navigation), for every status, before the
// server's hello and after it.

import type { QuickdrawStatus } from "@fitzzero/quickdraw-core/client";
import { describe, expect, it } from "vitest";
import { sessionEnded } from "./auth";

type Status = QuickdrawStatus["status"];

/** The connection with nobody known yet (or any more). */
function nobodyKnown(status: Status, refusal: QuickdrawStatus["refusal"] = null): boolean {
  return sessionEnded({ isKnown: false, status, refusal });
}

describe("sessionEnded", () => {
  it("is true once the server ended the session or refused a connect for it", () => {
    expect(nobodyKnown("disconnected")).toBe(true);
    expect(nobodyKnown("refused", { code: "UNAUTHENTICATED" })).toBe(true);
    expect(nobodyKnown("refused", { code: "REFUSED", message: "Forbidden" })).toBe(true);
  });

  it("is false while the connection is still on its way to the hello", () => {
    expect(nobodyKnown("idle")).toBe(false);
    expect(nobodyKnown("connecting")).toBe(false);
    expect(nobodyKnown("connected")).toBe(false);
  });

  it("is false for a server of another protocol, which signing in again would not help", () => {
    expect(nobodyKnown("refused", { code: "PROTOCOL_MISMATCH", expected: 6 })).toBe(false);
  });

  it("is false once the hello named who the connection is, whatever the status", () => {
    const statuses: Status[] = ["idle", "connecting", "connected", "disconnected", "refused"];
    for (const status of statuses) {
      expect(sessionEnded({ isKnown: true, status, refusal: null })).toBe(false);
    }
  });
});
