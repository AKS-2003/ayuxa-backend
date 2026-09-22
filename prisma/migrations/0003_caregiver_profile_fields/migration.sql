-- AlterTable
ALTER TABLE "caregiver_profiles"
  ADD COLUMN "photoUrl" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "dob" TIMESTAMP(3),
  ADD COLUMN "emergencyNumber" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'English',
  ADD COLUMN "jobRole" TEXT;
