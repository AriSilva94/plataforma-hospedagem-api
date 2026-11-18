-- CreateEnum
CREATE TYPE "RoomStoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "story_rejected_reason" TEXT,
ADD COLUMN     "story_status" "RoomStoryStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "room_story_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_story_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_story_media_storage_key_key" ON "room_story_media"("storage_key");

-- CreateIndex
CREATE INDEX "room_story_media_room_id_position_idx" ON "room_story_media"("room_id", "position");

-- AddForeignKey
ALTER TABLE "room_story_media" ADD CONSTRAINT "room_story_media_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
