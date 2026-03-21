-- CreateIndex
CREATE INDEX "Child_level_idx" ON "Child"("level");

-- CreateIndex
CREATE INDEX "Child_archivedAt_idx" ON "Child"("archivedAt");

-- CreateIndex
CREATE INDEX "DailySubmission_dailyTaskId_idx" ON "DailySubmission"("dailyTaskId");

-- CreateIndex
CREATE INDEX "DailyTask_taskDate_level_idx" ON "DailyTask"("taskDate", "level");
