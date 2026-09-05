-- Migración Fase 1 y 2 Combinadas

-- 1. Crear nuevo tipo de estado de ruta
CREATE TYPE "RouteStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- 2. Añadir nuevas columnas a RouteAssignment ANTES de migrar datos
ALTER TABLE "RouteAssignment" ADD COLUMN "routeId" TEXT;
ALTER TABLE "RouteAssignment" ADD COLUMN "voidedAt" TIMESTAMP(3);

-- 3. Crear la tabla Route
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sequenceIndex" INTEGER NOT NULL,
    "status" "RouteStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- 4. Crear índices
CREATE INDEX "Route_driverId_idx" ON "Route"("driverId");
CREATE INDEX "Route_date_idx" ON "Route"("date");

-- ====================================================================================
-- BACKFILL DE DATOS
-- ====================================================================================

-- Fase 1 (voidedAt): Reemplazar CANCELLED por voidedAt
UPDATE "RouteAssignment" 
SET "voidedAt" = CURRENT_TIMESTAMP, "status" = 'PENDING'
WHERE "status"::text = 'CANCELLED';

-- Fase 2 (Rutas): Agrupar e insertar Rutas
WITH RouteGroups AS (
  SELECT
    "driverId",
    "date"::date as route_date,
    bool_and("status" IN ('DELIVERED', 'OBSERVED')) as is_completed,
    max("updatedAt") as max_updated_at
  FROM "RouteAssignment"
  WHERE "voidedAt" IS NULL
  GROUP BY "driverId", "date"::date
)
INSERT INTO "Route" ("id", "driverId", "date", "sequenceIndex", "status", "completedAt", "updatedAt")
SELECT
  gen_random_uuid(),
  "driverId",
  route_date,
  1,
  CASE WHEN is_completed THEN 'COMPLETED'::"RouteStatus" ELSE 'PENDING'::"RouteStatus" END,
  CASE WHEN is_completed THEN max_updated_at ELSE NULL END,
  CURRENT_TIMESTAMP
FROM RouteGroups;

-- Fase 2 (Rutas): Asignar el routeId generado a los pedidos correspondientes
UPDATE "RouteAssignment" ra
SET "routeId" = r."id"
FROM "Route" r
WHERE ra."driverId" = r."driverId" AND ra."date"::date = r."date"::date AND ra."voidedAt" IS NULL;

-- ====================================================================================

-- 5. Alterar el Enum de AssignmentStatus AHORA QUE NO HAY 'CANCELLED'
BEGIN;
CREATE TYPE "AssignmentStatus_new" AS ENUM ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'OBSERVED');
ALTER TABLE "RouteAssignment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RouteAssignment" ALTER COLUMN "status" TYPE "AssignmentStatus_new" USING ("status"::text::"AssignmentStatus_new");
ALTER TYPE "AssignmentStatus" RENAME TO "AssignmentStatus_old";
ALTER TYPE "AssignmentStatus_new" RENAME TO "AssignmentStatus";
DROP TYPE "AssignmentStatus_old";
ALTER TABLE "RouteAssignment" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- 6. Añadir Foreign Keys al final
ALTER TABLE "Route" ADD CONSTRAINT "Route_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RouteAssignment" ADD CONSTRAINT "RouteAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;
