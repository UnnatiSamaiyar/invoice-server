-- Phase 1.10 - Basic Bill Matching / SOA Matching
-- Adds statement/bill entry capture, manual invoice matching, system suggestions, and discrepancy flags.

CREATE TYPE "BillEntryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "BillMatchStatus" AS ENUM ('UNMATCHED', 'SUGGESTED', 'MATCHED', 'DISCREPANCY', 'IGNORED');
CREATE TYPE "BillDiscrepancyType" AS ENUM (
  'AMOUNT_MISMATCH',
  'TAX_MISMATCH',
  'DUPLICATE_BILL',
  'PAYMENT_MISSING',
  'INVOICE_MISSING',
  'SOA_AMOUNT_MISMATCH'
);

CREATE TABLE "bill_entries" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "partyName" TEXT NOT NULL,
  "billNumber" TEXT NOT NULL,
  "billDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentReference" TEXT,
  "notes" TEXT,
  "status" "BillEntryStatus" NOT NULL DEFAULT 'ACTIVE',
  "matchStatus" "BillMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  "matchedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bill_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bill_match_suggestions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "billEntryId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "ruleHits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "reasons" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "bill_match_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bill_discrepancy_flags" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "billEntryId" TEXT NOT NULL,
  "type" "BillDiscrepancyType" NOT NULL,
  "message" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bill_discrepancy_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bill_entries_companyId_idx" ON "bill_entries"("companyId");
CREATE INDEX "bill_entries_companyId_status_idx" ON "bill_entries"("companyId", "status");
CREATE INDEX "bill_entries_companyId_matchStatus_idx" ON "bill_entries"("companyId", "matchStatus");
CREATE INDEX "bill_entries_companyId_billDate_idx" ON "bill_entries"("companyId", "billDate");
CREATE INDEX "bill_entries_companyId_partyName_idx" ON "bill_entries"("companyId", "partyName");
CREATE INDEX "bill_entries_companyId_billNumber_idx" ON "bill_entries"("companyId", "billNumber");
CREATE INDEX "bill_entries_invoiceId_idx" ON "bill_entries"("invoiceId");

CREATE INDEX "bill_match_suggestions_companyId_idx" ON "bill_match_suggestions"("companyId");
CREATE INDEX "bill_match_suggestions_billEntryId_idx" ON "bill_match_suggestions"("billEntryId");
CREATE INDEX "bill_match_suggestions_invoiceId_idx" ON "bill_match_suggestions"("invoiceId");
CREATE INDEX "bill_match_suggestions_companyId_score_idx" ON "bill_match_suggestions"("companyId", "score");

CREATE INDEX "bill_discrepancy_flags_companyId_idx" ON "bill_discrepancy_flags"("companyId");
CREATE INDEX "bill_discrepancy_flags_billEntryId_idx" ON "bill_discrepancy_flags"("billEntryId");
CREATE INDEX "bill_discrepancy_flags_companyId_type_idx" ON "bill_discrepancy_flags"("companyId", "type");

ALTER TABLE "bill_entries"
  ADD CONSTRAINT "bill_entries_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bill_entries"
  ADD CONSTRAINT "bill_entries_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bill_match_suggestions"
  ADD CONSTRAINT "bill_match_suggestions_billEntryId_fkey"
  FOREIGN KEY ("billEntryId") REFERENCES "bill_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bill_match_suggestions"
  ADD CONSTRAINT "bill_match_suggestions_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bill_discrepancy_flags"
  ADD CONSTRAINT "bill_discrepancy_flags_billEntryId_fkey"
  FOREIGN KEY ("billEntryId") REFERENCES "bill_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
