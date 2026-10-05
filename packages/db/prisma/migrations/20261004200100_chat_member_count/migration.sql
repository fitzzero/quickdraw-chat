-- The myChats item shows each chat's member count. It was counted from every
-- member's id on each list read (the game's world chat holds every player and
-- guest); it is a column now, kept by each membership write in its
-- transaction (apps/api/src/services/chat/membership.ts).
ALTER TABLE "chats" ADD COLUMN "member_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill: every chat's members as they are
UPDATE "chats"
SET "member_count" = (
  SELECT COUNT(*) FROM "chat_members" WHERE "chat_members"."chat_id" = "chats"."id"
);

-- A user's chats, which myChats reads by user on every open and resume
CREATE INDEX "chat_members_user_id_idx" ON "chat_members"("user_id");

-- Deleting a user (the admin screens) cascades their memberships inside the
-- database, where no tracked write sees them: count them out of their chats
-- before the cascade runs.
CREATE FUNCTION "chat_member_count_user_deleted"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "chats" SET "member_count" = "member_count" - 1
  WHERE "id" IN (SELECT "chat_id" FROM "chat_members" WHERE "user_id" = OLD."id");
  RETURN OLD;
END;
$$;

CREATE TRIGGER "users_count_out_of_chats"
BEFORE DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION "chat_member_count_user_deleted"();
