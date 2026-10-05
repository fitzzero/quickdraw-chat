-- quickdraw 5.0: sessions are kept for the auth routes kit (a SessionStore over
-- this table). A session's JWT names its row (`sid`) instead of the row storing
-- the token, so the token column goes and every existing session ends: everyone
-- signs in once more.
DELETE FROM "sessions";

DROP INDEX "sessions_token_key";

ALTER TABLE "sessions"
  DROP COLUMN "token",
  ADD COLUMN "provider" TEXT NOT NULL,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "ip" TEXT;

CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
