-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AyuxaAdminRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS_EXECUTIVE', 'SUPPORT_AGENT');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING_VERIFICATION', 'HQ_REVIEW', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ayuxa_admins" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "AyuxaAdminRole" NOT NULL DEFAULT 'SUPPORT_AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "refreshToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ayuxa_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ayuxa_admin_sessions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'PC',
    "ipAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayuxa_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ayuxa_audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayuxa_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_profiles" (
    "id" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "acknowledgementId" TEXT NOT NULL,
    "employeeId" TEXT,
    "presentAddress" TEXT NOT NULL DEFAULT '',
    "permanentAddress" TEXT NOT NULL DEFAULT '',
    "aadhaarNumber" TEXT NOT NULL DEFAULT '',
    "panNumber" TEXT NOT NULL DEFAULT '',
    "aadhaarUploaded" BOOLEAN NOT NULL DEFAULT false,
    "panUploaded" BOOLEAN NOT NULL DEFAULT false,
    "otherDocsUploaded" BOOLEAN NOT NULL DEFAULT false,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "pccUploaded" BOOLEAN NOT NULL DEFAULT false,
    "agreementAccepted" BOOLEAN NOT NULL DEFAULT false,
    "offerLetterGenerated" BOOLEAN NOT NULL DEFAULT false,
    "refreshToken" TEXT,
    "fcmDeviceToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_sessions" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'Mobile',
    "ipAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_check_ins" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "bookingId" TEXT,
    "patientUserId" TEXT,
    "patientName" TEXT NOT NULL,
    "patientCode" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "caregiverRole" TEXT NOT NULL,
    "scopeOfWork" TEXT NOT NULL,
    "shiftStart" TIMESTAMP(3) NOT NULL,
    "shiftEnd" TIMESTAMP(3) NOT NULL,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "checkInTime" TIMESTAMP(3),
    "checkInSelfieUrl" TEXT,
    "checkOutTime" TIMESTAMP(3),
    "checkOutSelfieUrl" TEXT,
    "vitalsBp" TEXT,
    "vitalsPulse" TEXT,
    "vitalsTemp" TEXT,
    "careSummary" TEXT,
    "checkoutComments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caregiver_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_in_tasks" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "check_in_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_uploads" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "patientUserId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "category" TEXT NOT NULL,
    "patientCode" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "caregiver_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_notifications" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channels" TEXT[],
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caregiver_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_accounts" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "photoUrl" TEXT,
    "refreshToken" TEXT,
    "fcmDeviceToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_account_sessions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL DEFAULT 'Mobile',
    "ipAddress" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_account_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_patient_links" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'Family',
    "canEdit" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_patient_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_team_members" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "caregiverId" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ayuxa_service_visits" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "checkOutTime" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayuxa_service_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ayuxa_otp_logs" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayuxa_otp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ayuxa_media_assets" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "folder" TEXT NOT NULL DEFAULT 'general',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ayuxa_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ayuxa_admins_email_key" ON "ayuxa_admins"("email");

-- CreateIndex
CREATE INDEX "ayuxa_admin_sessions_adminId_isActive_idx" ON "ayuxa_admin_sessions"("adminId", "isActive");

-- CreateIndex
CREATE INDEX "ayuxa_audit_logs_entity_entityId_idx" ON "ayuxa_audit_logs"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_profiles_caregiverId_key" ON "caregiver_profiles"("caregiverId");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_profiles_phone_key" ON "caregiver_profiles"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_profiles_acknowledgementId_key" ON "caregiver_profiles"("acknowledgementId");

-- CreateIndex
CREATE UNIQUE INDEX "caregiver_profiles_employeeId_key" ON "caregiver_profiles"("employeeId");

-- CreateIndex
CREATE INDEX "caregiver_sessions_profileId_isActive_idx" ON "caregiver_sessions"("profileId", "isActive");

-- CreateIndex
CREATE INDEX "caregiver_check_ins_profileId_idx" ON "caregiver_check_ins"("profileId");

-- CreateIndex
CREATE INDEX "caregiver_check_ins_patientUserId_idx" ON "caregiver_check_ins"("patientUserId");

-- CreateIndex
CREATE INDEX "caregiver_uploads_profileId_idx" ON "caregiver_uploads"("profileId");

-- CreateIndex
CREATE INDEX "caregiver_uploads_patientUserId_idx" ON "caregiver_uploads"("patientUserId");

-- CreateIndex
CREATE INDEX "caregiver_notifications_profileId_read_idx" ON "caregiver_notifications"("profileId", "read");

-- CreateIndex
CREATE UNIQUE INDEX "family_accounts_phone_key" ON "family_accounts"("phone");

-- CreateIndex
CREATE INDEX "family_account_sessions_accountId_isActive_idx" ON "family_account_sessions"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "family_patient_links_patientUserId_idx" ON "family_patient_links"("patientUserId");

-- CreateIndex
CREATE UNIQUE INDEX "family_patient_links_accountId_patientUserId_key" ON "family_patient_links"("accountId", "patientUserId");

-- CreateIndex
CREATE INDEX "care_team_members_patientUserId_idx" ON "care_team_members"("patientUserId");

-- CreateIndex
CREATE INDEX "ayuxa_service_visits_patientUserId_idx" ON "ayuxa_service_visits"("patientUserId");

-- CreateIndex
CREATE INDEX "ayuxa_otp_logs_phoneNumber_code_idx" ON "ayuxa_otp_logs"("phoneNumber", "code");

-- AddForeignKey
ALTER TABLE "ayuxa_admin_sessions" ADD CONSTRAINT "ayuxa_admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "ayuxa_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ayuxa_audit_logs" ADD CONSTRAINT "ayuxa_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "ayuxa_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_sessions" ADD CONSTRAINT "caregiver_sessions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "caregiver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_check_ins" ADD CONSTRAINT "caregiver_check_ins_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "caregiver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_tasks" ADD CONSTRAINT "check_in_tasks_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "caregiver_check_ins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_uploads" ADD CONSTRAINT "caregiver_uploads_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "caregiver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_notifications" ADD CONSTRAINT "caregiver_notifications_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "caregiver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_account_sessions" ADD CONSTRAINT "family_account_sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "family_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_patient_links" ADD CONSTRAINT "family_patient_links_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "family_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
