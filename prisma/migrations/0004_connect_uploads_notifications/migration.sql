-- CreateTable
CREATE TABLE "connect_uploads" (
    "id" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "uploadedByAccountId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'FAMILY',
    "uploadedBy" TEXT NOT NULL DEFAULT '',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_notifications" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connect_uploads_patientUserId_idx" ON "connect_uploads"("patientUserId");

-- CreateIndex
CREATE INDEX "connect_notifications_accountId_read_idx" ON "connect_notifications"("accountId", "read");

-- AddForeignKey
ALTER TABLE "connect_notifications" ADD CONSTRAINT "connect_notifications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "family_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
