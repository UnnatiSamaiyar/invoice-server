/*
  Warnings:

  - The values [INACTIVE] on the enum `ClientStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `creditLimit` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the column `openingBalance` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the column `taxProfileId` on the `clients` table. All the data in the column will be lost.
  - You are about to drop the `client_contacts` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ClientStatus_new" AS ENUM ('ACTIVE', 'ARCHIVED');
ALTER TABLE "public"."clients" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "clients" ALTER COLUMN "status" TYPE "ClientStatus_new" USING ("status"::text::"ClientStatus_new");
ALTER TYPE "ClientStatus" RENAME TO "ClientStatus_old";
ALTER TYPE "ClientStatus_new" RENAME TO "ClientStatus";
DROP TYPE "public"."ClientStatus_old";
ALTER TABLE "clients" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- DropForeignKey
ALTER TABLE "client_contacts" DROP CONSTRAINT "client_contacts_clientId_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_taxProfileId_fkey";

-- DropIndex
DROP INDEX "clients_taxProfileId_idx";

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "creditLimit",
DROP COLUMN "openingBalance",
DROP COLUMN "taxProfileId";

-- DropTable
DROP TABLE "client_contacts";
