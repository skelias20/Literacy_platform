-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Child" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;
