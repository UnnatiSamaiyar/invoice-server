-- Phase 1.8 - PDF / Print / Preview
-- Adds local PDF copy metadata to invoices. A fresh developer can run Prisma migrations from zero and get the full schema.

ALTER TABLE "invoices"
ADD COLUMN "pdfFileName" TEXT,
ADD COLUMN "pdfFilePath" TEXT,
ADD COLUMN "pdfGeneratedAt" TIMESTAMP(3);

CREATE INDEX "invoices_companyId_pdfGeneratedAt_idx" ON "invoices"("companyId", "pdfGeneratedAt");
