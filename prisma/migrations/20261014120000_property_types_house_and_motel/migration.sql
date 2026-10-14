ALTER TYPE "PropertyType" RENAME TO "PropertyType_old";

CREATE TYPE "PropertyType" AS ENUM ('HOUSE', 'MOTEL');

ALTER TABLE "properties"
  ALTER COLUMN "type" TYPE "PropertyType"
  USING (CASE WHEN "type"::text = 'MOTEL' THEN 'MOTEL' ELSE 'HOUSE' END)::"PropertyType";

DROP TYPE "PropertyType_old";
