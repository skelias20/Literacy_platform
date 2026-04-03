-- CreateEnum
CREATE TYPE "RenewalPaymentStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'RENEWAL_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'RENEWAL_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'SUBSCRIPTION_OVERRIDDEN';

-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "subscriptionExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PaymentEvent" ADD COLUMN     "renewalPaymentId" TEXT;

-- CreateTable
CREATE TABLE "BillingConfig" (
    "id" TEXT NOT NULL,
    "cycleDays" INTEGER NOT NULL DEFAULT 30,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 7,
    "renewalWindowDays" INTEGER NOT NULL DEFAULT 7,
    "monthlyFee" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedByAdminId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "renewalPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalPayment" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "RenewalPaymentStatus" NOT NULL DEFAULT 'pending',
    "transactionId" TEXT,
    "receiptFileId" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenewalPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_renewalPaymentId_key" ON "Subscription"("renewalPaymentId");

-- CreateIndex
CREATE INDEX "Subscription_childId_periodEnd_idx" ON "Subscription"("childId", "periodEnd");

-- CreateIndex
CREATE INDEX "Subscription_periodEnd_idx" ON "Subscription"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalPayment_receiptFileId_key" ON "RenewalPayment"("receiptFileId");

-- CreateIndex
CREATE INDEX "RenewalPayment_childId_idx" ON "RenewalPayment"("childId");

-- CreateIndex
CREATE INDEX "RenewalPayment_status_idx" ON "RenewalPayment"("status");

-- CreateIndex
CREATE INDEX "RenewalPayment_createdAt_idx" ON "RenewalPayment"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_renewalPaymentId_idx" ON "PaymentEvent"("renewalPaymentId");

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_renewalPaymentId_fkey" FOREIGN KEY ("renewalPaymentId") REFERENCES "RenewalPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingConfig" ADD CONSTRAINT "BillingConfig_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_renewalPaymentId_fkey" FOREIGN KEY ("renewalPaymentId") REFERENCES "RenewalPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalPayment" ADD CONSTRAINT "RenewalPayment_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalPayment" ADD CONSTRAINT "RenewalPayment_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenewalPayment" ADD CONSTRAINT "RenewalPayment_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: backfill Subscription rows for all existing approved students.
-- Uses Payment.reviewedAt (approval time) as periodStart; falls back to Payment.createdAt
-- if reviewedAt is null (payments approved before the auth fix was applied).
-- periodEnd = periodStart + 30 days (hardcoded — BillingConfig does not exist yet).
-- Also updates Child.subscriptionExpiresAt to match.

WITH billing AS (
  SELECT
    c.id                                                           AS child_id,
    COALESCE(p."reviewedAt", p."createdAt")                       AS period_start,
    COALESCE(p."reviewedAt", p."createdAt") + INTERVAL '30 days'  AS period_end
  FROM "Child" c
  INNER JOIN "Payment" p ON p."childId" = c.id
  WHERE c.status NOT IN ('pending_payment', 'rejected')
    AND p.status = 'approved'
)
INSERT INTO "Subscription" (id, "childId", "periodStart", "periodEnd", "createdAt")
SELECT
  gen_random_uuid(),
  child_id,
  period_start,
  period_end,
  NOW()
FROM billing
ON CONFLICT DO NOTHING;

UPDATE "Child"
SET "subscriptionExpiresAt" = s."periodEnd"
FROM "Subscription" s
WHERE "Child".id = s."childId"
  AND "Child"."subscriptionExpiresAt" IS NULL;
