-- AlterTable
ALTER TABLE "Order" ADD COLUMN "isPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "pauseReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "pausedById" TEXT;

-- CreateIndex
CREATE INDEX "Order_isPaused_idx" ON "Order"("isPaused");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pausedById_fkey" FOREIGN KEY ("pausedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
