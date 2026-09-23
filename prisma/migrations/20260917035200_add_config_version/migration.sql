-- AlterTable
ALTER TABLE "Run" ADD COLUMN     "configVersion" TEXT;

-- CreateIndex
CREATE INDEX "Run_configVersion_idx" ON "Run"("configVersion");
