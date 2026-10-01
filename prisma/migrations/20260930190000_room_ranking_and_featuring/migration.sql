-- DropIndex
DROP INDEX "properties_status_featured_created_at_idx";

-- AlterTable
ALTER TABLE "properties" DROP COLUMN "featured";

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "completeness_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "featured_from" TIMESTAMP(3),
ADD COLUMN     "featured_until" TIMESTAMP(3),
ADD COLUMN     "ranking_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ranking_updated_at" TIMESTAMP(3),
ADD COLUMN     "ranking_version" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "rooms_status_ranking_score_id_idx" ON "rooms"("status", "ranking_score" DESC, "id");

-- CreateIndex
CREATE INDEX "rooms_featured_until_idx" ON "rooms"("featured_until");

ALTER TABLE "rooms" ADD CONSTRAINT "rooms_completeness_score_check" CHECK ("completeness_score" BETWEEN 0 AND 100);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ranking_version_check" CHECK ("ranking_version" >= 0);
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_featured_period_check" CHECK (
  ("featured_from" IS NULL AND "featured_until" IS NULL)
  OR ("featured_from" IS NOT NULL AND "featured_until" IS NOT NULL AND "featured_until" > "featured_from")
);
