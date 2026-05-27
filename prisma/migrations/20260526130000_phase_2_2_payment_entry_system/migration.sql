-- Phase 2.2 - Payment Entry System
-- Adds overpayment/advance credit tracking and optional payment-proof metadata.

ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'ADVANCE_CREDIT';

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "creditAmount" DECIMAL(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE "invoice_payments"
  ADD COLUMN IF NOT EXISTS "paymentProofDataUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofFileName" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProofMimeType" TEXT;
