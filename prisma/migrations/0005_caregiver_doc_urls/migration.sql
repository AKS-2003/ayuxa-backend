-- Adds document URL columns to caregiver_profiles so admin can actually
-- view the Aadhaar/PAN/other docs a caregiver uploaded during KYC
-- (previously only boolean "uploaded" flags were stored, with the real
-- file URL discarded client-side after upload).
ALTER TABLE "caregiver_profiles" ADD COLUMN "aadhaarDocUrl" TEXT;
ALTER TABLE "caregiver_profiles" ADD COLUMN "panDocUrl" TEXT;
ALTER TABLE "caregiver_profiles" ADD COLUMN "otherDocsUrl" TEXT;
