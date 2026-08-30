-- AlterTable
ALTER TABLE "Order" ADD COLUMN "publicTrackingToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- CreateIndex
CREATE UNIQUE INDEX "Order_publicTrackingToken_key" ON "Order"("publicTrackingToken");
