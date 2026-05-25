-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "product_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "ItemType" NOT NULL DEFAULT 'SERVICE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsnSacSku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "defaultPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "defaultTax" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_items_companyId_idx" ON "product_items"("companyId");

-- CreateIndex
CREATE INDEX "product_items_companyId_status_idx" ON "product_items"("companyId", "status");

-- CreateIndex
CREATE INDEX "product_items_companyId_type_idx" ON "product_items"("companyId", "type");

-- CreateIndex
CREATE INDEX "product_items_companyId_name_idx" ON "product_items"("companyId", "name");

-- AddForeignKey
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
