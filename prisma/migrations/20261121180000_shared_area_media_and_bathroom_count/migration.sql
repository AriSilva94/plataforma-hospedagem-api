ALTER TABLE "properties" ADD COLUMN "shared_bathroom_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "properties" p
SET "shared_bathroom_count" = LEAST(counts.total, 20)
FROM (
  SELECT "property_id", COUNT(*)::int AS total
  FROM "property_shared_areas"
  WHERE "type" = 'SHARED_BATHROOM'
  GROUP BY "property_id"
) counts
WHERE counts."property_id" = p."id";

DELETE FROM "property_shared_areas" WHERE "type" = 'SHARED_BATHROOM';

UPDATE "property_shared_areas" a
SET "position" = ordered.new_position
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "property_id" ORDER BY "position", "created_at") - 1)::int AS new_position
  FROM "property_shared_areas"
) ordered
WHERE ordered."id" = a."id";

ALTER TYPE "SharedAreaType" RENAME TO "SharedAreaType_old";

CREATE TYPE "SharedAreaType" AS ENUM ('LIVING_ROOM', 'KITCHEN', 'DINING_ROOM', 'LAUNDRY', 'BALCONY', 'OUTDOOR_AREA', 'POOL', 'BARBECUE', 'GARAGE', 'OFFICE', 'OTHER');

ALTER TABLE "property_shared_areas"
  ALTER COLUMN "type" TYPE "SharedAreaType"
  USING ("type"::text)::"SharedAreaType";

DROP TYPE "SharedAreaType_old";

CREATE TABLE "property_shared_area_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shared_area_id" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_shared_area_media_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "property_shared_area_media_storage_key_key" ON "property_shared_area_media"("storage_key");

CREATE INDEX "property_shared_area_media_shared_area_id_position_idx" ON "property_shared_area_media"("shared_area_id", "position");

ALTER TABLE "property_shared_area_media" ADD CONSTRAINT "property_shared_area_media_shared_area_id_fkey" FOREIGN KEY ("shared_area_id") REFERENCES "property_shared_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
