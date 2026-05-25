-- CreateEnum
CREATE TYPE "InvoiceTemplateStyle" AS ENUM ('CLASSIC', 'MODERN', 'PREMIUM');

-- CreateEnum
CREATE TYPE "InvoiceDocumentTitle" AS ENUM ('INVOICE', 'TAX_INVOICE', 'BILL');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "templateStyle" "InvoiceTemplateStyle" NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "invoices" ADD COLUMN "documentTitle" "InvoiceDocumentTitle" NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "invoices" ADD COLUMN "brandColor" TEXT NOT NULL DEFAULT '#0B57D0';
ALTER TABLE "invoices" ADD COLUMN "showLogo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "invoices" ADD COLUMN "showSignature" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoices" ADD COLUMN "showQrCode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "invoices" ADD COLUMN "showBankDetails" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "invoice_template_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateStyle" "InvoiceTemplateStyle" NOT NULL DEFAULT 'CLASSIC',
    "documentTitle" "InvoiceDocumentTitle" NOT NULL DEFAULT 'INVOICE',
    "brandColor" TEXT NOT NULL DEFAULT '#0B57D0',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "showSignature" BOOLEAN NOT NULL DEFAULT false,
    "showQrCode" BOOLEAN NOT NULL DEFAULT true,
    "showBankDetails" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_template_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_template_settings_companyId_key" ON "invoice_template_settings"("companyId");

-- CreateIndex
CREATE INDEX "invoice_template_settings_companyId_idx" ON "invoice_template_settings"("companyId");

-- AddForeignKey
ALTER TABLE "invoice_template_settings" ADD CONSTRAINT "invoice_template_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
