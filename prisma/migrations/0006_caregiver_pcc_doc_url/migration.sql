-- Adds the PCC document URL column, same reasoning as 0005: the PCC
-- upload screen only ever stored a boolean flag, never the actual
-- uploaded document's URL, so admin had nothing to view.
ALTER TABLE "caregiver_profiles" ADD COLUMN "pccDocUrl" TEXT;
