/*
  Warnings:

  - You are about to drop the column `periodicSessionCount` on the `AssessmentConfig` table. All the data in the column will be lost.
  - You are about to drop the column `isAssessmentDefault` on the `ContentItem` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `reviewNote` on the `Payment` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "ContentItem_isAssessmentDefault_idx";

-- AlterTable
ALTER TABLE "AssessmentConfig" DROP COLUMN "periodicSessionCount",
ADD COLUMN     "taskFormat" "TaskFormat" NOT NULL DEFAULT 'free_response',
ALTER COLUMN "initialSessionCount" SET DEFAULT 1;

-- AlterTable
ALTER TABLE "ContentItem" DROP COLUMN "isAssessmentDefault";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "createdAt",
DROP COLUMN "reviewNote";

-- CreateTable
CREATE TABLE "AssessmentDefaultContent" (
    "id" TEXT NOT NULL,
    "level" "LiteracyLevel" NOT NULL,
    "skill" "SkillType" NOT NULL,
    "sessionNumber" INTEGER NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentDefaultContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentDefaultContent_level_skill_idx" ON "AssessmentDefaultContent"("level", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentDefaultContent_level_skill_sessionNumber_key" ON "AssessmentDefaultContent"("level", "skill", "sessionNumber");

-- AddForeignKey
ALTER TABLE "AssessmentDefaultContent" ADD CONSTRAINT "AssessmentDefaultContent_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentDefaultContent" ADD CONSTRAINT "AssessmentDefaultContent_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
