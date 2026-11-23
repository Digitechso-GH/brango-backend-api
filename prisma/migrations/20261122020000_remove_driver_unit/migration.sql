-- Move any remaining DriverProfile.unit plates into Vehicle before dropping the legacy column
DO $$
DECLARE
  dp RECORD;
  v_plate TEXT;
BEGIN
  FOR dp IN SELECT id, "tenantId", unit FROM "DriverProfile" WHERE unit IS NOT NULL AND TRIM(unit) <> '' LOOP
    v_plate := UPPER(TRIM(dp.unit));
    IF NOT EXISTS (
      SELECT 1 FROM "Vehicle" WHERE plate = v_plate AND ("tenantId" IS NOT DISTINCT FROM dp."tenantId")
    ) THEN
      INSERT INTO "Vehicle" (id, "tenantId", plate, "vehicleType", active, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, dp."tenantId", v_plate, 'CAMION', true, NOW(), NOW());
    END IF;
  END LOOP;
END $$;

ALTER TABLE "DriverProfile" DROP COLUMN IF EXISTS "unit";
