-- CreateTable
CREATE TABLE "property_shared_bathrooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_shared_bathrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_shared_bathroom_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shared_bathroom_id" UUID NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_shared_bathroom_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_shared_bathrooms_property_id_position_idx" ON "property_shared_bathrooms"("property_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "property_shared_bathroom_media_shared_bathroom_id_key" ON "property_shared_bathroom_media"("shared_bathroom_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_shared_bathroom_media_storage_key_key" ON "property_shared_bathroom_media"("storage_key");

-- AddForeignKey
ALTER TABLE "property_shared_bathrooms" ADD CONSTRAINT "property_shared_bathrooms_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_shared_bathroom_media" ADD CONSTRAINT "property_shared_bathroom_media_shared_bathroom_id_fkey" FOREIGN KEY ("shared_bathroom_id") REFERENCES "property_shared_bathrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "property_shared_bathroom_media" ADD CONSTRAINT "property_shared_bathroom_media_image_only" CHECK ("type" = 'IMAGE');

-- Backfill
INSERT INTO "property_shared_bathrooms" ("property_id", "position")
SELECT "id", "slot"
FROM "properties", generate_series(0, "shared_bathroom_count" - 1) AS "slot"
WHERE "shared_bathroom_count" > 0;
