-- Per-contact preferences for a patient's emergency contacts. The contacts
-- themselves live in medico's emergency_contacts table (never altered), so
-- Ayuxa-only settings such as "send this contact SMS alerts" are kept here,
-- keyed by that table's row id.
CREATE TABLE "ayuxa_emergency_contact_prefs" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "smsAlerts" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ayuxa_emergency_contact_prefs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ayuxa_emergency_contact_prefs_contactId_key" ON "ayuxa_emergency_contact_prefs"("contactId");
CREATE INDEX "ayuxa_emergency_contact_prefs_patientUserId_idx" ON "ayuxa_emergency_contact_prefs"("patientUserId");
