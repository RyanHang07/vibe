-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "caseId" TEXT;

-- CreateIndex
CREATE INDEX "Run_caseId_idx" ON "Run"("caseId");
