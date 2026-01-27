-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('pending_payment', 'approved_pending_login', 'assessment_required', 'active', 'rejected');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('receipt_upload', 'transaction_id');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "LiteracyLevel" AS ENUM ('foundational', 'functional', 'transitional', 'advanced');

-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('reading', 'listening', 'writing', 'speaking');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('passage_text', 'passage_audio', 'questions', 'writing_prompt', 'speaking_prompt', 'pdf_document');

-- CreateEnum
CREATE TYPE "AssessmentKind" AS ENUM ('initial', 'periodic');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PAYMENT_APPROVED', 'PAYMENT_REJECTED', 'CREDENTIALS_CREATED', 'LEVEL_ASSIGNED', 'LEVEL_CHANGED', 'DAILY_SKILL_FOCUS_SET', 'CONTENT_CREATED', 'CONTENT_ASSIGNED');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parent" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Child" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childFirstName" TEXT NOT NULL,
    "childLastName" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "username" TEXT,
    "passwordHash" TEXT,
    "credentialsCreatedById" TEXT,
    "credentialsCreatedAt" TIMESTAMP(3),
    "status" "AccountStatus" NOT NULL DEFAULT 'pending_payment',
    "level" "LiteracyLevel",
    "levelAssignedById" TEXT,
    "levelAssignedAt" TIMESTAMP(3),
    "lastDailySubmissionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByAdminId" TEXT,
    "uploadedByChildId" TEXT,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "transactionId" TEXT,
    "receiptFileId" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "skill" "SkillType" NOT NULL,
    "level" "LiteracyLevel",
    "type" "ContentType" NOT NULL,
    "textBody" TEXT,
    "fileId" TEXT,
    "assetUrl" TEXT,
    "mimeType" TEXT,
    "isAssessmentDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTask" (
    "id" TEXT NOT NULL,
    "taskDate" TIMESTAMP(3) NOT NULL,
    "skill" "SkillType" NOT NULL,
    "level" "LiteracyLevel",
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyTaskContent" (
    "dailyTaskId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,

    CONSTRAINT "DailyTaskContent_pkey" PRIMARY KEY ("dailyTaskId","contentItemId")
);

-- CreateTable
CREATE TABLE "DailySubmission" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "dailyTaskId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "rpEarned" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailySubmissionArtifact" (
    "id" TEXT NOT NULL,
    "dailySubmissionId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "textBody" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailySubmissionArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "kind" "AssessmentKind" NOT NULL DEFAULT 'initial',
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "assignedLevel" "LiteracyLevel",

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentArtifact" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "skill" "SkillType" NOT NULL,
    "textBody" TEXT,
    "fileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RpEvent" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "dailySubmissionId" TEXT,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT 'daily_completion',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetChildId" TEXT,
    "targetPaymentId" TEXT,
    "targetContentId" TEXT,
    "targetDailyTaskId" TEXT,
    "targetAssessmentId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Parent_email_idx" ON "Parent"("email");

-- CreateIndex
CREATE INDEX "Parent_phone_idx" ON "Parent"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Parent_email_phone_key" ON "Parent"("email", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Child_username_key" ON "Child"("username");

-- CreateIndex
CREATE INDEX "Child_status_idx" ON "Child"("status");

-- CreateIndex
CREATE INDEX "Child_parentId_idx" ON "Child"("parentId");

-- CreateIndex
CREATE INDEX "Child_lastDailySubmissionAt_idx" ON "Child"("lastDailySubmissionAt");

-- CreateIndex
CREATE INDEX "File_uploadedByChildId_idx" ON "File"("uploadedByChildId");

-- CreateIndex
CREATE INDEX "File_uploadedByAdminId_idx" ON "File"("uploadedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_childId_key" ON "Payment"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_receiptFileId_key" ON "Payment"("receiptFileId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "ContentItem_skill_level_idx" ON "ContentItem"("skill", "level");

-- CreateIndex
CREATE INDEX "ContentItem_isAssessmentDefault_idx" ON "ContentItem"("isAssessmentDefault");

-- CreateIndex
CREATE INDEX "DailyTask_taskDate_idx" ON "DailyTask"("taskDate");

-- CreateIndex
CREATE INDEX "DailyTask_skill_level_idx" ON "DailyTask"("skill", "level");

-- CreateIndex
CREATE INDEX "DailySubmission_childId_idx" ON "DailySubmission"("childId");

-- CreateIndex
CREATE INDEX "DailySubmission_submittedAt_idx" ON "DailySubmission"("submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailySubmission_childId_dailyTaskId_key" ON "DailySubmission"("childId", "dailyTaskId");

-- CreateIndex
CREATE INDEX "DailySubmissionArtifact_dailySubmissionId_idx" ON "DailySubmissionArtifact"("dailySubmissionId");

-- CreateIndex
CREATE INDEX "DailySubmissionArtifact_skill_idx" ON "DailySubmissionArtifact"("skill");

-- CreateIndex
CREATE INDEX "Assessment_childId_idx" ON "Assessment"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_childId_kind_key" ON "Assessment"("childId", "kind");

-- CreateIndex
CREATE INDEX "AssessmentArtifact_assessmentId_idx" ON "AssessmentArtifact"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentArtifact_skill_idx" ON "AssessmentArtifact"("skill");

-- CreateIndex
CREATE INDEX "RpEvent_childId_idx" ON "RpEvent"("childId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_idx" ON "AdminAuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetChildId_idx" ON "AdminAuditLog"("targetChildId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Parent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_credentialsCreatedById_fkey" FOREIGN KEY ("credentialsCreatedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Child" ADD CONSTRAINT "Child_levelAssignedById_fkey" FOREIGN KEY ("levelAssignedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedByChildId_fkey" FOREIGN KEY ("uploadedByChildId") REFERENCES "Child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTaskContent" ADD CONSTRAINT "DailyTaskContent_dailyTaskId_fkey" FOREIGN KEY ("dailyTaskId") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyTaskContent" ADD CONSTRAINT "DailyTaskContent_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySubmission" ADD CONSTRAINT "DailySubmission_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySubmission" ADD CONSTRAINT "DailySubmission_dailyTaskId_fkey" FOREIGN KEY ("dailyTaskId") REFERENCES "DailyTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySubmissionArtifact" ADD CONSTRAINT "DailySubmissionArtifact_dailySubmissionId_fkey" FOREIGN KEY ("dailySubmissionId") REFERENCES "DailySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailySubmissionArtifact" ADD CONSTRAINT "DailySubmissionArtifact_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentArtifact" ADD CONSTRAINT "AssessmentArtifact_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentArtifact" ADD CONSTRAINT "AssessmentArtifact_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RpEvent" ADD CONSTRAINT "RpEvent_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RpEvent" ADD CONSTRAINT "RpEvent_dailySubmissionId_fkey" FOREIGN KEY ("dailySubmissionId") REFERENCES "DailySubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetChildId_fkey" FOREIGN KEY ("targetChildId") REFERENCES "Child"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetPaymentId_fkey" FOREIGN KEY ("targetPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetContentId_fkey" FOREIGN KEY ("targetContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetDailyTaskId_fkey" FOREIGN KEY ("targetDailyTaskId") REFERENCES "DailyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_targetAssessmentId_fkey" FOREIGN KEY ("targetAssessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
