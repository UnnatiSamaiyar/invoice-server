-- CreateEnum
CREATE TYPE "TaxProfileType" AS ENUM ('NO_TAX', 'INDIA_GST', 'GENERIC_VAT', 'GENERIC_SALES_TAX', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaxCalculationMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- CreateEnum
CREATE TYPE "TaxApplicationLevel" AS ENUM ('ITEM_LEVEL', 'INVOICE_LEVEL');

-- CreateEnum
CREATE TYPE "TaxProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TaxComponentType" AS ENUM ('CGST', 'SGST', 'IGST', 'VAT', 'SALES_TAX', 'CUSTOM');

-- AlterTable
ALTER TABLE "product_items" ADD COLUMN "defaultTaxProfileId" TEXT;

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxProfileType" NOT NULL DEFAULT 'CUSTOM',
    "country" TEXT,
    "region" TEXT,
    "taxNumberLabel" TEXT,
    "taxNumber" TEXT,
    "hsnSacRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultRate" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "calculationMode" "TaxCalculationMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "applicationLevel" "TaxApplicationLevel" NOT NULL DEFAULT 'ITEM_LEVEL',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rate_components" (
    "id" TEXT NOT NULL,
    "taxProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TaxComponentType" NOT NULL DEFAULT 'CUSTOM',
    "rate" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rate_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_items_defaultTaxProfileId_idx" ON "product_items"("defaultTaxProfileId");

-- CreateIndex
CREATE INDEX "tax_profiles_companyId_idx" ON "tax_profiles"("companyId");

-- CreateIndex
CREATE INDEX "tax_profiles_companyId_status_idx" ON "tax_profiles"("companyId", "status");

-- CreateIndex
CREATE INDEX "tax_profiles_companyId_type_idx" ON "tax_profiles"("companyId", "type");

-- CreateIndex
CREATE INDEX "tax_profiles_companyId_isDefault_idx" ON "tax_profiles"("companyId", "isDefault");

-- CreateIndex
CREATE INDEX "tax_rate_components_taxProfileId_idx" ON "tax_rate_components"("taxProfileId");

-- AddForeignKey
ALTER TABLE "tax_profiles" ADD CONSTRAINT "tax_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rate_components" ADD CONSTRAINT "tax_rate_components_taxProfileId_fkey" FOREIGN KEY ("taxProfileId") REFERENCES "tax_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_defaultTaxProfileId_fkey" FOREIGN KEY ("defaultTaxProfileId") REFERENCES "tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
