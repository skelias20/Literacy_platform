-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "r2Key" TEXT,
ADD COLUMN     "storageUrl" TEXT,
ADD COLUMN     "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "ContentItem_deletedAt_idx" ON "ContentItem"("deletedAt");

-- CreateIndex
CREATE INDEX "File_uploadStatus_idx" ON "File"("uploadStatus");

-- CreateIndex
CREATE INDEX "File_deletedAt_idx" ON "File"("deletedAt");
