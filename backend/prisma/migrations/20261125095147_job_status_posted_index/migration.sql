-- Index for the "All open" view without a country filter (review finding).
CREATE INDEX "Job_status_postedAt_idx" ON "Job"("status", "postedAt" DESC);
