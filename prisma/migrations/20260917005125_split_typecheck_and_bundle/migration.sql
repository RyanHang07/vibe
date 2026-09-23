-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "typecheckAttempted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "typecheckDurationMs" INTEGER,
ADD COLUMN     "typecheckExitCode" INTEGER,
ADD COLUMN     "typecheckStderr" TEXT,
ADD COLUMN     "typecheckSucceeded" BOOLEAN;

-- CreateIndex
CREATE INDEX "Run_typecheckSucceeded_idx" ON "Run"("typecheckSucceeded");
