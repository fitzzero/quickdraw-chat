// The admin sidebar on the mock client (no server): a save shows the row the
// write returned, from the cache, without reading it again, and asks the
// list to read its page again.

import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { adminOf } from "@fitzzero/quickdraw-core/client";
import { createMockClient } from "@fitzzero/quickdraw-core/testing/client";
import { contracts, type AdminServiceMeta } from "@project/shared";
import { describe, expect, it, vi } from "vitest";
import { IntlProvider } from "../../providers/IntlProvider";
import { AdminEntitySidebar } from "./AdminEntitySidebar";

/** The typed client's members, with stubs. */
const mock = createMockClient(contracts, { userId: "user-ada" });
/** The chat service's admin screen, as the admin page takes it (`adminOf`). */
const admin = adminOf(mock, "chatService");
const { adminGet } = admin;
if (adminGet === undefined) throw new Error("the chat admin kit exposes adminGet");

const CHAT = {
  id: "chat-1",
  title: "Standup",
  lastMessageAt: "2026-10-20T09:00:00.000Z",
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-20T09:00:00.000Z",
};
/** What adminUpdate answers: the renamed row, with a time no draft holds. */
const SAVED = { ...CHAT, title: "Renamed", updatedAt: "2026-10-26T09:00:00.000Z" };

/** What `adminMeta` answers for the chats: the title is the field an admin edits. */
const META: AdminServiceMeta = {
  serviceName: "chatService",
  displayName: "Chats",
  fields: [
    {
      name: "id",
      type: "string",
      label: "ID",
      required: false,
      editable: false,
      showInTable: true,
      sortable: false,
    },
    {
      name: "title",
      type: "string",
      label: "Title",
      required: true,
      editable: true,
      showInTable: true,
      sortable: true,
    },
    {
      name: "createdAt",
      type: "date",
      label: "Created",
      required: false,
      editable: false,
      showInTable: true,
      sortable: true,
    },
  ],
};

function Providers({ children }: { readonly children?: React.ReactNode }): React.ReactElement {
  return (
    <IntlProvider>
      <mock.$Provider>{children}</mock.$Provider>
    </IntlProvider>
  );
}

describe("AdminEntitySidebar", () => {
  it("shows the row a save returned, without reading it again", async () => {
    mock.chatService.admin.adminGet.mockResolvedValue(CHAT);
    mock.chatService.admin.adminUpdate.mockResolvedValue(SAVED);
    const onChanged = vi.fn();
    render(
      <AdminEntitySidebar
        admin={admin}
        adminGet={adminGet}
        entryId={CHAT.id}
        meta={META}
        onClose={(): void => undefined}
        onChanged={onChanged}
        onDeleted={(): void => undefined}
      />,
      { wrapper: Providers },
    );
    expect(await screen.findByText("Standup")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // the write's answer, from the cache (not the draft: its updatedAt is the
    // server's), and one read, the first
    expect(await screen.findByText("Renamed")).toBeTruthy();
    expect(mock.$queryClient.getQueryData(adminGet.key({ id: CHAT.id }))).toEqual(SAVED);
    expect(mock.chatService.admin.adminUpdate.calls).toEqual([
      { id: CHAT.id, data: { title: "Renamed" } },
    ]);
    expect(mock.chatService.admin.adminGet.calls).toEqual([{ id: CHAT.id }]);
    // the list reads its page again
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
