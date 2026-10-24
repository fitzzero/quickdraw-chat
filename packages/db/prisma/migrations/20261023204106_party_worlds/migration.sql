-- AlterTable
ALTER TABLE "game_worlds" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "code" TEXT,
ADD COLUMN     "host_user_id" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'server';

-- CreateIndex
CREATE UNIQUE INDEX "game_worlds_code_key" ON "game_worlds"("code");

-- CreateIndex
CREATE INDEX "game_worlds_host_user_id_idx" ON "game_worlds"("host_user_id");

