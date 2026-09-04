-- AlterTable Route
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "overviewPolyline" TEXT;

-- AlterTable RouteAssignment
ALTER TABLE "RouteAssignment" ADD COLUMN IF NOT EXISTS "stopGroupId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RouteAssignment_stopGroupId_idx" ON "RouteAssignment"("stopGroupId");
