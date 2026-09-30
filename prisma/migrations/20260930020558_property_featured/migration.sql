ALTER TABLE "properties" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "properties_status_featured_created_at_idx" ON "properties"("status", "featured", "created_at");
