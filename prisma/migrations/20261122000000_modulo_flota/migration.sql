-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LicenseCategory" AS ENUM ('A_I', 'A_IIa', 'A_IIb', 'A_IIIa', 'A_IIIb', 'A_IIIc');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "VehicleType" AS ENUM ('AUTOMOVIL', 'CAMIONETA', 'PICKUP', 'FURGON', 'CAMION', 'TRACTO', 'OTRO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable DriverProfile
ALTER TABLE "DriverProfile"
  ADD COLUMN IF NOT EXISTS "licenseNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "licenseCategory" "LicenseCategory",
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Vehicle
ALTER TABLE "Vehicle"
  ADD COLUMN IF NOT EXISTS "axles" INTEGER,
  ADD COLUMN IF NOT EXISTS "capacityKg" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "capacityM3" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "vehicleType" "VehicleType" NOT NULL DEFAULT 'CAMION',
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable Route
ALTER TABLE "Route"
  ADD COLUMN IF NOT EXISTS "vehicleId" TEXT;

-- Backfill existing routes that have no vehicleId yet
DO $$
DECLARE
  r RECORD;
  v_id TEXT;
  v_plate TEXT;
BEGIN
  FOR r IN SELECT rt.id, rt."tenantId", dp.unit FROM "Route" rt LEFT JOIN "DriverProfile" dp ON dp.id = rt."driverId" WHERE rt."vehicleId" IS NULL LOOP
    v_plate := COALESCE(NULLIF(UPPER(TRIM(r.unit)), ''), 'SIN-PLACA');

    SELECT id INTO v_id
    FROM "Vehicle"
    WHERE plate = v_plate AND ("tenantId" IS NOT DISTINCT FROM r."tenantId")
    LIMIT 1;

    IF v_id IS NULL THEN
      INSERT INTO "Vehicle" (id, "tenantId", plate, "vehicleType", active, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, r."tenantId", v_plate, 'CAMION', true, NOW(), NOW())
      RETURNING id INTO v_id;
    END IF;

    UPDATE "Route" SET "vehicleId" = v_id WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE "Route"
  ALTER COLUMN "vehicleId" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Route_vehicleId_idx" ON "Route"("vehicleId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Route" ADD CONSTRAINT "Route_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
