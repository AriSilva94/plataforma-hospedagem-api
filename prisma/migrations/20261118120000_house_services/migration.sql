-- CreateEnum
CREATE TYPE "CleaningFrequency" AS ENUM ('DAILY', 'SEVERAL_TIMES_WEEK', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'ON_DEMAND');

-- CreateEnum
CREATE TYPE "SmokingPolicy" AS ENUM ('NOT_ALLOWED', 'OUTDOOR_ONLY', 'ALLOWED');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "cleaning_frequency" "CleaningFrequency",
ADD COLUMN     "has_cleaner" BOOLEAN,
ADD COLUMN     "smoking_policy" "SmokingPolicy";

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "cleaning_frequency" "CleaningFrequency",
ADD COLUMN     "has_cleaner" BOOLEAN,
ADD COLUMN     "smoking_policy" "SmokingPolicy";
