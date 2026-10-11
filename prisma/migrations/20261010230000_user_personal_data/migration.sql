-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "state" CHAR(2);

ALTER TABLE "users" ADD CONSTRAINT "users_phone_check" CHECK ("phone" ~ '^\+55[0-9]{10,11}$');
ALTER TABLE "users" ADD CONSTRAINT "users_birth_date_check" CHECK ("birth_date" >= DATE '1900-01-01');
ALTER TABLE "users" ADD CONSTRAINT "users_state_check" CHECK ("state" ~ '^[A-Z]{2}$');
