// The chat screens against the real server: the API's services on
// quickdraw's test server, a real socket per render, the real provider and
// hooks (renderWithQuickdraw). What the two-browser manual run checks, kept:
// the live chat list (a new chat appears, a message reorders it), a message
// from another member, a send shown at once that settles into the server's
// row, and a refused or deleted chat shown as before.

import * as React from "react";
import { fireEvent, waitFor, type RenderResult } from "@testing-library/react";
import {
  renderWithQuickdraw,
  type QuickdrawRenderResult,
} from "@fitzzero/quickdraw-core/testing/client";
import { testPrisma } from "@project/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestChat } from "../../../api/src/__tests__/factories/chat-factory";
import { createTestUser } from "../../../api/src/__tests__/factories/user-factory";
import { startTestApp, type ApiTestApp } from "../../../api/src/__tests__/utils/app";
import ChatPage from "../app/chats/[chatId]/page";
import ChatsPage from "../app/chats/page";
import { ChatSidebar } from "../components/chat/ChatSidebar";
import { ChatWindow } from "../components/chat/ChatWindow";
import { qd } from "../lib/quickdraw";
import { IntlProvider } from "../providers/IntlProvider";
import { LayoutProvider } from "../providers/LayoutProvider";

// The route the pages read
const route = vi.hoisted(() => ({ chatId: "" }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ chatId: route.chatId }),
  usePathname: () => `/chats/${route.chatId}`,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

/** The app's own providers the screens need around quickdraw's. */
function AppProviders({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <IntlProvider>
      <LayoutProvider>{children}</LayoutProvider>
    </IntlProvider>
  );
}

let app: ApiTestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

async function renderAs(userId: string, ui: React.ReactElement): Promise<QuickdrawRenderResult> {
  return await renderWithQuickdraw(ui, {
    app,
    as: { userId },
    client: qd,
    wrapper: AppProviders,
  });
}

function as(userId: string): ReturnType<ApiTestApp["as"]> {
  return app.as({ userId });
}

/**
 * Holds every call of `method` the server receives until `release()`, as a
 * slow network would: what the client shows meanwhile is what a user sees
 * while the call is on its way.
 */
function holdCalls(method: string): { release: () => void } {
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  app.server.io.on("connection", (socket) => {
    socket.use(([event, envelope], next) => {
      const named = (envelope as { m?: unknown } | undefined)?.m;
      if (event === "qd:call" && named === method) {
        void held.then(() => {
          next();
        });
      } else {
        next();
      }
    });
  });
  return { release };
}

/** The chat titles the list shows, top to bottom. */
function listedTitles(view: RenderResult): string[] {
  return Array.from(
    view.container.querySelectorAll("a[href^='/chats/'] .MuiListItemText-primary"),
    (element) => element.textContent ?? "",
  );
}

async function twoMembers(): Promise<{ ada: string; bo: string }> {
  const ada = await createTestUser({ name: "Ada" });
  const bo = await createTestUser({ name: "Bo" });
  return { ada: ada.id, bo: bo.id };
}

describe("the chat list (myChats)", () => {
  it("shows a chat someone creates with the user, and moves a chat with a new message to the top", async () => {
    const { ada, bo } = await twoMembers();
    const members = [{ userId: ada }, { userId: bo }];
    const older = await createTestChat({ title: "Older chat", members });
    await createTestChat({ title: "Newer chat", members });

    const view = await renderAs(ada, <ChatsPage />);
    await view.findByText("Newer chat");
    expect(listedTitles(view)).toEqual(["Newer chat", "Older chat"]);

    // A message moves its chat to the top (lastMessageAt orders the list)
    await as(bo).messageService.postMessage({ chatId: older.id, content: "bump" });
    await waitFor(() => {
      expect(listedTitles(view)).toEqual(["Older chat", "Newer chat"]);
    });

    // A chat another user creates with this one appears, on top
    await as(bo).chatService.createChat({
      title: "From Bo",
      members: [{ userId: ada, level: "Read" }],
    });
    await waitFor(() => {
      expect(listedTitles(view)).toEqual(["From Bo", "Older chat", "Newer chat"]);
    });
  });
});

describe("a chat's messages (byChat)", () => {
  it("shows a message another member posts, without a refresh", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: ada }, { userId: bo }] });

    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");

    await as(bo).messageService.postMessage({ chatId: chat.id, content: "Hello from Bo" });
    await view.findByText("Hello from Bo");
  });

  it("shows a sent message at once, as sending, then the server's row in its place", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: ada }, { userId: bo }] });
    const network = holdCalls("postMessage");

    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    fireEvent.change(view.getByPlaceholderText("Type a message..."), {
      target: { value: "On its way" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));

    // Before the server has it: shown, marked as sending
    const pending = await view.findByTestId("pending-message");
    expect(pending.textContent).toContain("On its way");
    expect(pending.textContent).toContain("Sending…");

    // The server takes it: byChat delivers the row, which replaces the bubble
    network.release();
    await waitFor(() => {
      expect(view.queryByTestId("pending-message")).toBeNull();
    });
    expect(view.getByText("On its way")).toBeTruthy();
    expect(view.queryByText("Sending…")).toBeNull();
  });

  it("keeps a refused message, marked, with a retry", async () => {
    const { ada, bo } = await twoMembers();
    // Ada is not a member: her history is refused (empty), and so is a post
    const chat = await createTestChat({ members: [{ userId: bo }] });

    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    fireEvent.change(view.getByPlaceholderText("Type a message..."), {
      target: { value: "Let me in" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));

    const pending = await view.findByTestId("pending-message");
    await waitFor(() => {
      expect(pending.textContent).toContain("Not sent: You don't have permission to do that.");
    });
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("the chat sidebar", () => {
  it("shows a rename at once (optimistic), before the server has it", async () => {
    const { ada, bo } = await twoMembers();
    // Ada first: the chat's Admin, who may rename it
    const chat = await createTestChat({
      title: "Old title",
      members: [{ userId: ada }, { userId: bo }],
    });
    const network = holdCalls("updateTitle");

    const view = await renderAs(ada, <ChatSidebar chatId={chat.id} />);
    await view.findByText("Old title");
    fireEvent.click(await view.findByRole("button", { name: "Chat Title" }));
    const input = view.getByRole("textbox", { name: "Chat Title" });
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The server has not answered: the overlay shows the new title already
    await view.findByText("New title");
    expect(view.queryByText("Old title")).toBeNull();

    // It answers: the row is written, and its own title takes over, the same
    network.release();
    await waitFor(async () => {
      const row = await testPrisma.chat.findUnique({ where: { id: chat.id } });
      expect(row?.title).toBe("New title");
    });
    expect(view.getByText("New title")).toBeTruthy();
  });

  it("shows a member invited elsewhere, live, and again after a reconnect (the roster's room)", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ title: "Roster", members: [{ userId: ada }] });

    const view = await renderAs(ada, <ChatSidebar chatId={chat.id} />);
    await view.findByText("Ada");
    await as(ada).chatService.inviteUser({ id: chat.id, userId: bo, level: "Read" });
    await view.findByText("Bo");

    // a new socket is in no room: the roster is read again, which joins it
    await view.disconnect();
    await view.reconnect();
    const cy = await createTestUser({ name: "Cy" });
    await as(ada).chatService.inviteUser({ id: chat.id, userId: cy.id, level: "Read" });
    await view.findByText("Cy");
  });
});

describe("the chat page", () => {
  it("shows NoPermission for a chat the user is not a member of (FORBIDDEN)", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ title: "Private", members: [{ userId: bo }] });
    route.chatId = chat.id;

    const view = await renderAs(ada, <ChatPage />);
    await view.findByText("You don't have access to this chat");
  });

  it("shows NotFound once the chat is deleted while it is open", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({
      title: "Short-lived",
      members: [{ userId: bo }, { userId: ada }],
    });
    route.chatId = chat.id;

    const view = await renderAs(ada, <ChatPage />);
    await view.findByText("No messages yet. Start the conversation!");

    await as(bo).chatService.deleteChat({ id: chat.id });
    await view.findByText("Chat not found");
  });
});
