-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "buildAttempted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "buildDurationMs" INTEGER,
ADD COLUMN     "buildExitCode" INTEGER,
ADD COLUMN     "buildStderr" TEXT,
ADD COLUMN     "buildSucceeded" BOOLEAN;

-- CreateIndex
CREATE INDEX "Run_buildSucceeded_idx" ON "Run"("buildSucceeded");
