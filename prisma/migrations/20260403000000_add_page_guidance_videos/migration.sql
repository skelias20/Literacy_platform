-- CreateTable
CREATE TABLE "PageGuidanceVideo" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "updatedByAdminId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageGuidanceVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PageGuidanceVideo_pageKey_key" ON "PageGuidanceVideo"("pageKey");

-- AddForeignKey
ALTER TABLE "PageGuidanceVideo" ADD CONSTRAINT "PageGuidanceVideo_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
