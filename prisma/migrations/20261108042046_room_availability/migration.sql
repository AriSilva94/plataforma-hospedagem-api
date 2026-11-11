-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "blocked_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "room_blocked_dates" (
    "room_id" UUID NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "room_blocked_dates_pkey" PRIMARY KEY ("room_id","date")
);

-- AddForeignKey
ALTER TABLE "room_blocked_dates" ADD CONSTRAINT "room_blocked_dates_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
