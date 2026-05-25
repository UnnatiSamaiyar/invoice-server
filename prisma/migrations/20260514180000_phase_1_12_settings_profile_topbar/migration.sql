-- Phase 1.12: Settings, Profile, Notifications, and Topbar support

ALTER TYPE "CompanyRole" ADD VALUE IF NOT EXISTS 'STAFF';

ALTER TABLE "users"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "avatarDataUrl" TEXT,
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en',
  ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "securityNotifications" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "companies"
  ADD COLUMN "businessType" TEXT,
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "defaultInvoiceTitle" "InvoiceDocumentTitle" NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN "defaultPaymentTerms" TEXT NOT NULL DEFAULT 'Net 30',
  ADD COLUMN "defaultTermsAndConditions" TEXT,
  ADD COLUMN "footerNote" TEXT,
  ADD COLUMN "accountHolderName" TEXT,
  ADD COLUMN "upiId" TEXT,
  ADD COLUMN "paymentNote" TEXT,
  ADD COLUMN "showBankDetailsOnInvoice" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "showQrCodeOnInvoice" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "manualInvoiceNumberEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "notification_reads" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "notificationKey" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_reads_userId_companyId_notificationKey_key" ON "notification_reads"("userId", "companyId", "notificationKey");
CREATE INDEX "notification_reads_companyId_idx" ON "notification_reads"("companyId");
CREATE INDEX "notification_reads_userId_idx" ON "notification_reads"("userId");

ALTER TABLE "notification_reads"
  ADD CONSTRAINT "notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_reads"
  ADD CONSTRAINT "notification_reads_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
