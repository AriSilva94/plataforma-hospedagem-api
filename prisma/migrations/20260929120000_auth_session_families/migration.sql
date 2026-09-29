ALTER TABLE "auth_sessions"
    ADD COLUMN "family_id" UUID,
    ADD COLUMN "absolute_expires_at" TIMESTAMP(3),
    ADD COLUMN "replaced_by_session_id" UUID;

UPDATE "auth_sessions"
SET "family_id" = "id",
    "absolute_expires_at" = GREATEST("expires_at", "created_at" + INTERVAL '90 days');

ALTER TABLE "auth_sessions"
    ALTER COLUMN "family_id" SET NOT NULL,
    ALTER COLUMN "absolute_expires_at" SET NOT NULL;

CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");
