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

/**
 * Answers the next call of `method` a socket sends with a failure
 * (`INTERNAL`, as a failing handler's), once, without running it: a send
 * that fails for a reason that passes. Every later call goes through.
 */
function refuseNextCall(method: string): void {
  let refused = false;
  app.server.io.on("connection", (socket) => {
    socket.use(([event, envelope, reply], next) => {
      const named = (envelope as { m?: unknown } | undefined)?.m;
      if (!refused && event === "qd:call" && named === method && typeof reply === "function") {
        refused = true;
        reply({ ok: false, e: { code: "INTERNAL", message: "The server failed" } });
      } else {
        next();
      }
    });
  });
}

/**
 * Runs the next call of `method` a socket sends and drops its answer, once:
 * the server wrote what the call asked for and told the rooms, and the caller
 * never hears back. Every later call goes through.
 */
function dropNextAnswer(method: string): void {
  let dropped = false;
  app.server.io.on("connection", (socket) => {
    socket.use((packet, next) => {
      const call = packet[1] as { m?: unknown } | undefined;
      if (!dropped && packet[0] === "qd:call" && call?.m === method) {
        dropped = true;
        packet.splice(2, 1, () => undefined);
      }
      next();
    });
  });
}

/** A message send as the chat window makes it: `postMessage`'s input. */
interface SentMessage {
  readonly id: string;
  readonly chatId: string;
  readonly content: string;
}

/**
 * Takes the next call of `method` a socket sends and answers nothing, once:
 * the server has the call, and the connection can drop before its answer.
 * Resolves with the call's input once the server has it; the call runs only
 * if the test runs it. Every later call goes through.
 */
function holdNextCall(method: string): Promise<unknown> {
  let taken = false;
  return new Promise<unknown>((resolve) => {
    app.server.io.on("connection", (socket) => {
      socket.use(([event, envelope], next) => {
        const call = envelope as { m?: unknown; i?: unknown } | undefined;
        if (!taken && event === "qd:call" && call?.m === method) {
          taken = true;
          resolve(call.i);
        } else {
          next();
        }
      });
    });
  });
}

/** Types `content` in the chat window's input and sends it. */
function sendMessage(view: RenderResult, content: string): void {
  fireEvent.change(view.getByPlaceholderText("Type a message..."), {
    target: { value: content },
  });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
}

/** A version 4 UUID: the id the chat window makes for each message it sends. */
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The chat's stored messages: their ids and contents. */
async function storedMessages(chatId: string): Promise<{ id: string; content: string }[]> {
  return await testPrisma.message.findMany({
    where: { chatId },
    select: { id: true, content: true },
  });
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

    const refused = await view.findByTestId("failed-message");
    expect(refused.textContent).toContain("Let me in");
    expect(refused.textContent).toContain("Not sent: You don't have permission to do that.");
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("keeps each refused send until it is retried or dismissed, whatever is sent after", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: bo }] });
    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    const send = async (content: string, count: number): Promise<void> => {
      fireEvent.change(view.getByPlaceholderText("Type a message..."), {
        target: { value: content },
      });
      fireEvent.click(view.getByRole("button", { name: "Send message" }));
      await waitFor(() => {
        expect(view.getAllByTestId("failed-message")).toHaveLength(count);
      });
    };

    await send("first try", 1);
    // the next send no longer drops the first one
    await send("second try", 2);
    const texts = (): string[] =>
      view.getAllByTestId("failed-message").map((bubble) => bubble.textContent ?? "");
    expect(texts()[0]).toContain("first try");
    expect(texts()[1]).toContain("second try");

    fireEvent.click(view.getAllByRole("button", { name: "Dismiss" })[0] ?? document.body);
    await waitFor(() => {
      expect(view.getAllByTestId("failed-message")).toHaveLength(1);
    });
    expect(texts()[0]).toContain("second try");

    // a retry sends it again: refused again, it is kept again, once
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(view.getAllByTestId("failed-message")).toHaveLength(1);
    });
    expect(texts()[0]).toContain("second try");
  });

  it("keeps a refused send when its chat is shown again, and shows it in that chat only", async () => {
    const { ada, bo } = await twoMembers();
    const refusing = await createTestChat({ members: [{ userId: bo }] });
    const own = await createTestChat({ members: [{ userId: ada }] });
    const view = await renderAs(ada, <ChatWindow chatId={refusing.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    fireEvent.change(view.getByPlaceholderText("Type a message..."), {
      target: { value: "Still there?" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await view.findByTestId("failed-message");

    // another chat's window: none of the first chat's refused sends
    view.rerender(<ChatWindow key="own" chatId={own.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    expect(view.queryByTestId("failed-message")).toBeNull();

    // a new window on the first chat: the client still holds it
    view.rerender(<ChatWindow key="again" chatId={refusing.id} />);
    expect((await view.findByTestId("failed-message")).textContent).toContain("Still there?");
  });

  it("sends a refused message again on retry, and shows the server's row once taken", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: ada }, { userId: bo }] });
    // the first send fails for a reason that passes; the retry goes through
    refuseNextCall("postMessage");
    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    fireEvent.change(view.getByPlaceholderText("Type a message..."), {
      target: { value: "Second time lucky" },
    });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    const refused = await view.findByTestId("failed-message");
    expect(refused.textContent).toContain("Not sent: Something went wrong. Try again.");

    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(view.queryByTestId("failed-message")).toBeNull();
    });
    await view.findByText("Second time lucky");
    await waitFor(() => {
      expect(view.queryByTestId("pending-message")).toBeNull();
    });
    const stored = await testPrisma.message.findMany({
      where: { chatId: chat.id },
      select: { content: true, userId: true },
    });
    expect(stored).toEqual([{ content: "Second time lucky", userId: ada }]);
  });
});

describe("a send whose connection drops before its answer", () => {
  it("shows it checking, then the server's one message, with nothing to retry, once the server wrote it", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: ada }, { userId: bo }] });
    const received = holdNextCall("postMessage");
    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    sendMessage(view, "Cut off");
    const sent = (await received) as SentMessage;
    expect(sent.id).toMatch(CLIENT_ID);

    // the connection drops before the answer: the server may have it, so the
    // message stays, checking, and nothing offers to send it again
    await view.disconnect();
    expect((await view.findByTestId("pending-message")).textContent).toContain("Checking…");
    expect(view.queryByTestId("failed-message")).toBeNull();

    // the server goes on and writes it, as the held call would
    await as(ada).messageService.postMessage(sent);

    // the reconnect's load holds it, by the id the window made: one message, the server's
    await view.reconnect();
    await waitFor(() => {
      expect(view.queryByTestId("pending-message")).toBeNull();
    });
    expect(view.getAllByText("Cut off")).toHaveLength(1);
    expect(view.queryByTestId("failed-message")).toBeNull();
    expect(await storedMessages(chat.id)).toEqual([{ id: sent.id, content: "Cut off" }]);
  });

  it("shows the server's one message, sent, when only the answer was lost and the reconnect brings nothing new", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: ada }, { userId: bo }] });
    dropNextAnswer("postMessage");
    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    sendMessage(view, "Answer lost");

    // the server ran it and told the chat's room; give its frame the moment
    // it needs to reach this window, which still waits for the answer (the
    // window shows the same either way, so there is nothing to wait on)
    await waitFor(async () => {
      expect(await storedMessages(chat.id)).toHaveLength(1);
    });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 150);
    });
    expect((await view.findByTestId("pending-message")).textContent).toContain("Sending…");

    // the connection drops with the answer still owed: checking
    await view.disconnect();
    expect((await view.findByTestId("pending-message")).textContent).toContain("Checking…");

    // the reconnect's load has nothing new to bring (the row came before the
    // drop), and still ends the wait: one message, sent, nothing to retry
    await view.reconnect();
    await waitFor(() => {
      expect(view.queryByTestId("pending-message")).toBeNull();
    });
    expect(view.getAllByText("Answer lost")).toHaveLength(1);
    expect(view.queryByTestId("failed-message")).toBeNull();
    expect(await storedMessages(chat.id)).toHaveLength(1);
  });

  it("refuses it once the reconnect's load answers without it, and its retry posts it once", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: ada }, { userId: bo }] });
    // the call reaches the server, which never runs it
    const received = holdNextCall("postMessage");
    const view = await renderAs(ada, <ChatWindow chatId={chat.id} />);
    await view.findByText("No messages yet. Start the conversation!");
    sendMessage(view, "Lost on the way");
    await received;

    await view.disconnect();
    expect((await view.findByTestId("pending-message")).textContent).toContain("Checking…");

    // the chat's next load (the reconnect's) has no such message: not sent, and why
    await view.reconnect();
    const refused = await view.findByTestId("failed-message");
    expect(refused.textContent).toContain("Lost on the way");
    expect(refused.textContent).toContain(
      "Not sent: The connection dropped before the server answered. Try again.",
    );
    expect(view.queryByTestId("pending-message")).toBeNull();

    // the retry is the same call, with the same id: one message
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(view.queryByTestId("failed-message")).toBeNull();
    });
    await waitFor(() => {
      expect(view.queryByTestId("pending-message")).toBeNull();
    });
    expect(view.getAllByText("Lost on the way")).toHaveLength(1);
    const stored = await storedMessages(chat.id);
    expect(stored.map((message) => message.content)).toEqual(["Lost on the way"]);
    expect(stored[0]?.id).toMatch(CLIENT_ID);
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

  it("says why the roster was refused, and its retry reads it and joins its room", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ title: "Closed", members: [{ userId: bo }] });

    // Ada is no member: reading the roster (and joining its room) is refused
    const view = await renderAs(ada, <ChatSidebar chatId={chat.id} />);
    await view.findByText("Members not loaded: You don't have permission to do that.");

    // Bo invites her; the retry runs the same call at once, on this socket
    await as(bo).chatService.inviteUser({ id: chat.id, userId: ada, level: "Read" });
    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await view.findByText("Ada");
    expect(view.queryByText(/Members not loaded/)).toBeNull();

    // the socket is in the roster's room now: the next change arrives live
    const cy = await createTestUser({ name: "Cy" });
    await as(bo).chatService.inviteUser({ id: chat.id, userId: cy.id, level: "Read" });
    await view.findByText("Cy");
  });
});

describe("the chat page", () => {
  it("says deleted-or-not-a-member for a chat the server refuses (FORBIDDEN)", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ title: "Private", members: [{ userId: bo }] });
    route.chatId = chat.id;

    const view = await renderAs(ada, <ChatPage />);
    await view.findByText("This chat was deleted, or you are not a member of it");
  });

  it("says the same for a chat deleted while the page was away (FORBIDDEN, not removed)", async () => {
    const { ada, bo } = await twoMembers();
    const chat = await createTestChat({ members: [{ userId: bo }, { userId: ada }] });
    route.chatId = chat.id;
    const view = await renderAs(ada, <ChatPage />);
    await view.findByText("No messages yet. Start the conversation!");

    await view.disconnect();
    await as(bo).chatService.deleteChat({ id: chat.id });
    await view.reconnect();
    await view.findByText("This chat was deleted, or you are not a member of it");
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
