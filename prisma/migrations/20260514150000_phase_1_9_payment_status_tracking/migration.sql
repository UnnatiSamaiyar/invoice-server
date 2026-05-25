-- Phase 1.9: Payment Status Basic Tracking

CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER');

CREATE TABLE "invoice_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'UPI',
    "referenceNumber" TEXT,
    "amountReceived" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "invoice_payments_companyId_idx" ON "invoice_payments"("companyId");
CREATE INDEX "invoice_payments_companyId_paymentDate_idx" ON "invoice_payments"("companyId", "paymentDate");
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
