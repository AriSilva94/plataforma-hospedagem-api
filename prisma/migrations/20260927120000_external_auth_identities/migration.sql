ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

CREATE TABLE "external_auth_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_auth_identities_provider_provider_subject_key" ON "external_auth_identities"("provider", "provider_subject");
CREATE INDEX "external_auth_identities_user_id_idx" ON "external_auth_identities"("user_id");

ALTER TABLE "external_auth_identities" ADD CONSTRAINT "external_auth_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
