-- Phase 2.1: Advanced Client Management
-- Adds business account fields, client contacts, tax profile mapping, and inactive status.

ALTER TYPE "ClientStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxProfileId" TEXT;

CREATE TABLE IF NOT EXISTS "client_contacts" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clients_taxProfileId_idx" ON "clients"("taxProfileId");
CREATE INDEX IF NOT EXISTS "client_contacts_clientId_idx" ON "client_contacts"("clientId");
CREATE INDEX IF NOT EXISTS "client_contacts_clientId_isPrimary_idx" ON "client_contacts"("clientId", "isPrimary");

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_taxProfileId_fkey"
  FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "client_contacts"
  ADD CONSTRAINT "client_contacts_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
