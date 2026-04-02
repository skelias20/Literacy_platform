-- CreateEnum
CREATE TYPE "UnknownWordSource" AS ENUM ('assessment', 'daily_task', 'manual');

-- CreateTable
CREATE TABLE "UnknownWord" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "source" "UnknownWordSource" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnknownWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnknownWord_childId_createdAt_idx" ON "UnknownWord"("childId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnknownWord_childId_word_key" ON "UnknownWord"("childId", "word");

-- AddForeignKey
ALTER TABLE "UnknownWord" ADD CONSTRAINT "UnknownWord_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE CASCADE ON UPDATE CASCADE;
