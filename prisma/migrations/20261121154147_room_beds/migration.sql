-- CreateEnum
CREATE TYPE "BedType" AS ENUM ('SINGLE', 'DOUBLE', 'QUEEN', 'KING', 'BUNK', 'SOFA_BED');

-- CreateTable
CREATE TABLE "room_beds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "type" "BedType" NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "room_beds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_beds_room_id_idx" ON "room_beds"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_beds_room_id_type_key" ON "room_beds"("room_id", "type");

-- AddForeignKey
ALTER TABLE "room_beds" ADD CONSTRAINT "room_beds_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "room_beds" ("room_id", "type", "quantity")
SELECT "id", 'DOUBLE', 1 FROM "rooms" WHERE 'DOUBLE_BED' = ANY("amenities");

INSERT INTO "room_beds" ("room_id", "type", "quantity")
SELECT "id", 'SINGLE', 1 FROM "rooms" WHERE 'SINGLE_BED' = ANY("amenities");

UPDATE "rooms" SET "amenities" = array_remove(array_remove("amenities", 'DOUBLE_BED'), 'SINGLE_BED');
