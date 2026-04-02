-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "periodicCycleNumber" INTEGER;

-- AlterTable
ALTER TABLE "AssessmentConfig" ADD COLUMN     "periodicSessionCount" INTEGER NOT NULL DEFAULT 1;
