-- quickdraw 5.0: the myChats collection orders by the chat's latest activity,
-- and a collection's order names columns only. Chat.lastMessageAt is that
-- column: the time of the chat's latest message, else its creation time,
-- maintained by messageService.postMessage from here on.
ALTER TABLE "chats" ADD COLUMN "last_message_at" TIMESTAMP(3);

UPDATE "chats"
SET "last_message_at" = COALESCE(
  (SELECT MAX("messages"."created_at") FROM "messages" WHERE "messages"."chat_id" = "chats"."id"),
  "chats"."created_at"
);

ALTER TABLE "chats"
  ALTER COLUMN "last_message_at" SET NOT NULL,
  ALTER COLUMN "last_message_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Message.acl held [{ userId: author, level: "Admin" }] on every row; the
-- message service's policy now gives the author Admin (owner on user_id).
ALTER TABLE "messages" DROP COLUMN "acl";
