-- AlterTable
ALTER TABLE "streams" ADD COLUMN     "alertMessageId" TEXT;

-- CreateIndex
CREATE INDEX "streams_alertMessageId_idx" ON "streams"("alertMessageId");
