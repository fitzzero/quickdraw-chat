-- CreateTable
CREATE TABLE "game_worlds" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chat_id" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_scores" (
    "id" TEXT NOT NULL,
    "world_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "best_length" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_worlds_slug_key" ON "game_worlds"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "game_scores_world_id_user_id_key" ON "game_scores"("world_id", "user_id");

-- AddForeignKey
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "game_worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_scores" ADD CONSTRAINT "game_scores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
