-- CreateEnum
CREATE TYPE "TaskFormat" AS ENUM ('free_response', 'mcq', 'msaq', 'fill_blank');

-- DropIndex
DROP INDEX "Assessment_childId_kind_key";

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "isLatest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sessionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "taskFormat" "TaskFormat" NOT NULL DEFAULT 'free_response',
ADD COLUMN     "triggeredByAdminId" TEXT;

-- AlterTable
ALTER TABLE "AssessmentArtifact" ADD COLUMN     "answersJson" JSONB;

-- AlterTable
ALTER TABLE "DailySubmissionArtifact" ADD COLUMN     "answersJson" JSONB;

-- AlterTable
ALTER TABLE "DailyTask" ADD COLUMN     "taskFormat" "TaskFormat" NOT NULL DEFAULT 'free_response',
ADD COLUMN     "writingMaxWords" INTEGER,
ADD COLUMN     "writingMinWords" INTEGER;

-- CreateTable
CREATE TABLE "AssessmentConfig" (
    "id" TEXT NOT NULL,
    "initialSessionCount" INTEGER NOT NULL DEFAULT 3,
    "periodicSessionCount" INTEGER NOT NULL DEFAULT 1,
    "updatedByAdminId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assessment_childId_kind_isLatest_idx" ON "Assessment"("childId", "kind", "isLatest");

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_triggeredByAdminId_fkey" FOREIGN KEY ("triggeredByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentConfig" ADD CONSTRAINT "AssessmentConfig_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
