-- AlterTable
ALTER TABLE "AssessmentArtifact" ADD COLUMN     "contentItemId" TEXT;

-- AddForeignKey
ALTER TABLE "AssessmentArtifact" ADD CONSTRAINT "AssessmentArtifact_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
