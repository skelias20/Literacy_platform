/*
  Warnings:

  - Added the required column `dateOfBirth` to the `Child` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Child" ADD COLUMN "dateOfBirth" TIMESTAMP(3) NOT NULL DEFAULT '2000-01-01 00:00:00';
ALTER TABLE "Child" ALTER COLUMN "dateOfBirth" DROP DEFAULT;