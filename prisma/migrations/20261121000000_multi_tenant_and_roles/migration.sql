-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('PLAN_1', 'PLAN_2', 'PLAN_3', 'PLAN_4');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "ruc" TEXT NOT NULL,
    "planTier" "PlanTier" NOT NULL DEFAULT 'PLAN_1',
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_ruc_key" ON "Tenant"("ruc");

-- CreateIndex
CREATE INDEX "TenantConfig_tenantId_idx" ON "TenantConfig"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantConfig_tenantId_key_key" ON "TenantConfig"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "TenantConfig" ADD CONSTRAINT "TenantConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex (legacy global uniques replaced by per-tenant uniques)
DROP INDEX IF EXISTS "Company_ruc_key";
DROP INDEX IF EXISTS "Order_code_key";
DROP INDEX IF EXISTS "Vehicle_plate_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "DriverProfile" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

-- Seed initial Tenant (COMERCIAL AQUAMUNDO PERU S.A.C.) & backfill existing records
INSERT INTO "Tenant" ("id", "name", "tradeName", "ruc", "planTier", "status", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-a000-000000000001',
  'COMERCIAL AQUAMUNDO PERU S.A.C.',
  'Aquamundo',
  '20603105029',
  'PLAN_1',
  'ACTIVE',
  NOW(),
  NOW()
)
ON CONFLICT ("ruc") DO NOTHING;

UPDATE "User" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "DriverProfile" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Company" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Customer" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Branch" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Order" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Route" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;
UPDATE "Vehicle" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "ruc" = '20603105029' LIMIT 1) WHERE "tenantId" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "User_tenantId_idx" ON "User"("tenantId");
CREATE INDEX IF NOT EXISTS "DriverProfile_tenantId_idx" ON "DriverProfile"("tenantId");
CREATE INDEX IF NOT EXISTS "Company_tenantId_idx" ON "Company"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Company_tenantId_ruc_key" ON "Company"("tenantId", "ruc");
CREATE INDEX IF NOT EXISTS "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX IF NOT EXISTS "Branch_tenantId_idx" ON "Branch"("tenantId");
CREATE INDEX IF NOT EXISTS "Order_tenantId_idx" ON "Order"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_tenantId_code_key" ON "Order"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "Route_tenantId_idx" ON "Route"("tenantId");
CREATE INDEX IF NOT EXISTS "Vehicle_tenantId_idx" ON "Vehicle"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Vehicle_tenantId_plate_key" ON "Vehicle"("tenantId", "plate");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Route" ADD CONSTRAINT "Route_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
