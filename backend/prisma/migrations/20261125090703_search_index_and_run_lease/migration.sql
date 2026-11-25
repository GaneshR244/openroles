-- Fast substring search for the sales page search box (docs/ARCHITECTURE.md §3.2, §3.13).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "job_title_trgm" ON "Job" USING gin ("title" gin_trgm_ops);
CREATE INDEX "company_name_trgm" ON "Company" USING gin ("name" gin_trgm_ops);

-- Run lease: at most one RUNNING fetch run can exist at a time (§3.11).
CREATE UNIQUE INDEX "fetch_run_single_running" ON "FetchRun" ((true)) WHERE "status" = 'RUNNING';
