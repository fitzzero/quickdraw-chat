import { testPrisma } from "@project/db/testing";

export interface TestChatMember {
  userId: string;
  level?: "Read" | "Moderate" | "Admin";
}

/**
 * Create a chat with members. The first member defaults to Admin (creator
 * semantics), the rest to Read, unless levels are given explicitly.
 */
export async function createTestChat(options: {
  title?: string;
  members: TestChatMember[];
}): Promise<{ id: string; title: string }> {
  return testPrisma.chat.create({
    data: {
      title: options.title ?? "Factory Chat",
      members: {
        create: options.members.map((member, index) => ({
          userId: member.userId,
          level: member.level ?? (index === 0 ? "Admin" : "Read"),
        })),
      },
    },
    select: { id: true, title: true },
  });
}

/** Create a message authored by userId; creator gets entry-level Admin. */
export async function createTestMessage(options: {
  chatId: string;
  userId: string;
  content?: string;
}): Promise<{ id: string }> {
  return testPrisma.message.create({
    data: {
      chatId: options.chatId,
      userId: options.userId,
      content: options.content ?? "Factory message",
      acl: [{ userId: options.userId, level: "Admin" }],
    },
    select: { id: true },
  });
}
