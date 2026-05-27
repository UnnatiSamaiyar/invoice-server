-- Repair Client advanced profile, TaxProfile relation, Client contacts, and Google auth fields.
-- Safe/idempotent for local dev databases that received mixed phase ZIP migrations.

DO $$
BEGIN
  CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "googleId" TEXT,
  ADD COLUMN IF NOT EXISTS "authProvider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "ClientStatus" ADD VALUE IF NOT EXISTS 'INACTIVE';

ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditLimit" DECIMAL(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "taxProfileId" TEXT;

DO $$
BEGIN
  ALTER TABLE "clients"
  ADD CONSTRAINT "clients_taxProfileId_fkey"
  FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "clients_taxProfileId_idx" ON "clients"("taxProfileId");

CREATE TABLE IF NOT EXISTS "client_contacts" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "role" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  ALTER TABLE "client_contacts"
  ADD CONSTRAINT "client_contacts_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "client_contacts_clientId_idx" ON "client_contacts"("clientId");
