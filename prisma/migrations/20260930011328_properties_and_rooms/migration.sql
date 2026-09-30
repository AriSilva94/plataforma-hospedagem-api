CREATE TYPE "GenderIdentity" AS ENUM ('MAN', 'WOMAN', 'TRANS_WOMAN', 'TRANS_MAN');

CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'APARTMENT', 'TOWNHOUSE', 'STUDIO', 'SHARED_HOUSE', 'OTHER');

CREATE TYPE "PropertyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNAVAILABLE');

CREATE TYPE "SharedAreaType" AS ENUM ('LIVING_ROOM', 'KITCHEN', 'SHARED_BATHROOM', 'LAUNDRY', 'OUTDOOR_AREA', 'GARAGE', 'OTHER');

CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'INACTIVE');

CREATE TYPE "BathroomType" AS ENUM ('PRIVATE', 'SHARED');

CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

ALTER TABLE "guest_profiles" ADD COLUMN "gender_identity" "GenderIdentity";

CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_profile_id" UUID NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "PropertyType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "house_rules" TEXT,
    "general_info" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postal_code" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" CHAR(2),
    "reference_points" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "property_shared_areas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "type" "SharedAreaType" NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_shared_areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "property_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "property_id" UUID NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bathroom_type" "BathroomType" NOT NULL,
    "accepted_audiences" "GenderIdentity"[],
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "additional_info" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "room_media" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "type" "MediaType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "properties_owner_profile_id_idx" ON "properties"("owner_profile_id");

CREATE INDEX "property_shared_areas_property_id_idx" ON "property_shared_areas"("property_id");

CREATE UNIQUE INDEX "property_media_storage_key_key" ON "property_media"("storage_key");

CREATE INDEX "property_media_property_id_position_idx" ON "property_media"("property_id", "position");

CREATE INDEX "rooms_property_id_idx" ON "rooms"("property_id");

CREATE UNIQUE INDEX "room_media_storage_key_key" ON "room_media"("storage_key");

CREATE INDEX "room_media_room_id_position_idx" ON "room_media"("room_id", "position");

ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "owner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "property_shared_areas" ADD CONSTRAINT "property_shared_areas_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "property_media" ADD CONSTRAINT "property_media_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "room_media" ADD CONSTRAINT "room_media_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "properties" ADD CONSTRAINT "properties_state_check" CHECK ("state" ~ '^[A-Z]{2}$');

ALTER TABLE "property_media" ADD CONSTRAINT "property_media_size_bytes_check" CHECK ("size_bytes" > 0);
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_position_check" CHECK ("position" >= 0);

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_price_cents_check" CHECK ("price_cents" > 0);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_capacity_check" CHECK ("capacity" BETWEEN 1 AND 20);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_accepted_audiences_check" CHECK (cardinality("accepted_audiences") >= 1);

ALTER TABLE "room_media" ADD CONSTRAINT "room_media_size_bytes_check" CHECK ("size_bytes" > 0);
ALTER TABLE "room_media" ADD CONSTRAINT "room_media_position_check" CHECK ("position" >= 0);
