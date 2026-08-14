/*
  Warnings:

  - You are about to drop the column `orderId` on the `Evidence` table. All the data in the column will be lost.
  - You are about to drop the column `orderId` on the `LocationSnapshot` table. All the data in the column will be lost.
  - Added the required column `routeAssignmentId` to the `Evidence` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Evidence" DROP CONSTRAINT "Evidence_orderId_fkey";

-- DropForeignKey
ALTER TABLE "LocationSnapshot" DROP CONSTRAINT "LocationSnapshot_orderId_fkey";

-- DropIndex
DROP INDEX "Evidence_orderId_idx";

-- DropIndex
DROP INDEX "LocationSnapshot_orderId_idx";

-- AlterTable
ALTER TABLE "Evidence" DROP COLUMN "orderId",
ADD COLUMN     "routeAssignmentId" TEXT NOT NULL,
ADD COLUMN     "signatureText" TEXT;

-- AlterTable
ALTER TABLE "LocationSnapshot" DROP COLUMN "orderId",
ADD COLUMN     "routeAssignmentId" TEXT;

-- CreateIndex
CREATE INDEX "Evidence_routeAssignmentId_idx" ON "Evidence"("routeAssignmentId");

-- CreateIndex
CREATE INDEX "LocationSnapshot_routeAssignmentId_idx" ON "LocationSnapshot"("routeAssignmentId");

-- AddForeignKey
ALTER TABLE "LocationSnapshot" ADD CONSTRAINT "LocationSnapshot_routeAssignmentId_fkey" FOREIGN KEY ("routeAssignmentId") REFERENCES "RouteAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_routeAssignmentId_fkey" FOREIGN KEY ("routeAssignmentId") REFERENCES "RouteAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
