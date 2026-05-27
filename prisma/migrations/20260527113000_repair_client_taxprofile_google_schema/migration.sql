-- Repair migration for Phase 2.1 client tax profile relation + Google auth fields.
-- Safe to run after conflicting Phase 2.2 / Google migrations because it uses IF NOT EXISTS checks.

ALTER TYPE "ClientStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

DO $$
BEGIN
  CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "googleId" TEXT,
  ADD COLUMN IF NOT EXISTS "authProvider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");

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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "clients_taxProfileId_idx" ON "clients"("taxProfileId");
CREATE INDEX IF NOT EXISTS "client_contacts_clientId_idx" ON "client_contacts"("clientId");
CREATE INDEX IF NOT EXISTS "client_contacts_clientId_isPrimary_idx" ON "client_contacts"("clientId", "isPrimary");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'clients_taxProfileId_fkey'
  ) THEN
    ALTER TABLE "clients"
      ADD CONSTRAINT "clients_taxProfileId_fkey"
      FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_contacts_clientId_fkey'
  ) THEN
    ALTER TABLE "client_contacts"
      ADD CONSTRAINT "client_contacts_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "clients"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
