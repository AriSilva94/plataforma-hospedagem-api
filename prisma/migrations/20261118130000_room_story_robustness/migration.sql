-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "story_approved_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "room_story_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "story_approved_at" TIMESTAMP(3) NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 1,
    "first_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_story_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_story_views_user_id_idx" ON "room_story_views"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_story_views_room_id_user_id_story_approved_at_key" ON "room_story_views"("room_id", "user_id", "story_approved_at");

-- AddForeignKey
ALTER TABLE "room_story_views" ADD CONSTRAINT "room_story_views_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_story_views" ADD CONSTRAINT "room_story_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill
UPDATE "rooms" SET "story_approved_at" = now() WHERE "story_status" = 'APPROVED';
