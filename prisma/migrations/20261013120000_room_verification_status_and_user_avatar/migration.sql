-- CreateEnum
CREATE TYPE "RoomVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable: rooms.verified (boolean) -> rooms.verification_status (enum)
ALTER TABLE "rooms" ADD COLUMN "verification_status" "RoomVerificationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "rooms" ADD COLUMN "verification_rejected_reason" TEXT;

UPDATE "rooms" SET "verification_status" = 'VERIFIED' WHERE "verified" = true;

ALTER TABLE "rooms" DROP COLUMN "verified";

-- AlterTable: users.avatar_key
ALTER TABLE "users" ADD COLUMN "avatar_key" TEXT;
