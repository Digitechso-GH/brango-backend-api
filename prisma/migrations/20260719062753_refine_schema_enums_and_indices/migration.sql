/*
  Warnings:

  - You are about to drop the column `ruc` on the `Cliente` table. All the data in the column will be lost.
  - The `estadoAnterior` column on the `OrderTimeline` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `estado` column on the `Pedido` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `geocodingStatus` column on the `Pedido` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `estadoNuevo` on the `OrderTimeline` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'OBSERVED');

-- CreateEnum
CREATE TYPE "GeocodingStatus" AS ENUM ('PENDING', 'VALIDATED', 'FAILED');

-- DropIndex
DROP INDEX "Cliente_ruc_key";

-- AlterTable
ALTER TABLE "Cliente" DROP COLUMN "ruc";

-- AlterTable
ALTER TABLE "OrderTimeline" DROP COLUMN "estadoAnterior",
ADD COLUMN     "estadoAnterior" "EstadoPedido",
DROP COLUMN "estadoNuevo",
ADD COLUMN     "estadoNuevo" "EstadoPedido" NOT NULL;

-- AlterTable
ALTER TABLE "Pedido" DROP COLUMN "estado",
ADD COLUMN     "estado" "EstadoPedido" NOT NULL DEFAULT 'PENDING',
DROP COLUMN "geocodingStatus",
ADD COLUMN     "geocodingStatus" "GeocodingStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Evidence_pedidoId_idx" ON "Evidence"("pedidoId");

-- CreateIndex
CREATE INDEX "LocationSnapshot_driverId_idx" ON "LocationSnapshot"("driverId");

-- CreateIndex
CREATE INDEX "LocationSnapshot_pedidoId_idx" ON "LocationSnapshot"("pedidoId");

-- CreateIndex
CREATE INDEX "OrderTimeline_pedidoId_idx" ON "OrderTimeline"("pedidoId");

-- CreateIndex
CREATE INDEX "OrderTimeline_userId_idx" ON "OrderTimeline"("userId");

-- CreateIndex
CREATE INDEX "Pedido_estado_idx" ON "Pedido"("estado");
