/*
  Warnings:

  - A unique constraint covering the columns `[parentContentItemId]` on the table `ContentItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "parentContentItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_parentContentItemId_key" ON "ContentItem"("parentContentItemId");

-- CreateIndex
CREATE INDEX "ContentItem_parentContentItemId_idx" ON "ContentItem"("parentContentItemId");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_parentContentItemId_fkey" FOREIGN KEY ("parentContentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
