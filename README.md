# OpenRoles

An internal tool that shows Hyring's sales team which companies are hiring, for which role, with a link to the live job post. Every morning it collects new public job posts from every country, saves each role once, and a sales page lists them.

- What and why: [`REQUIREMENTS.md`](REQUIREMENTS.md)
- How it works (HLD + LLD): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Build log: [`docs/PROGRESS.md`](docs/PROGRESS.md)
- Rules for contributors and Claude Code: [`CLAUDE.md`](CLAUDE.md)

## How it fits together

```
06:00 IST cron (@nestjs/schedule, inside the API) ──▶ fetch run ──▶ public job boards (no API keys)
                          │                  Greenhouse · Lever · Ashby · SmartRecruiters · Workable
                          │                  boards found monthly in Common Crawl (free web archive)
                          ▼                  + LinkedIn logged-out job search (20 cities)
                     PostgreSQL ◀── backend API (read-only, x-api-key) ◀── frontend (Next.js) ◀── sales team
```

| Folder | What | Stack |
|---|---|---|
| `backend/` | Daily fetch script plus read-only API | NestJS 12, Prisma 7, PostgreSQL, Vitest |
| `frontend/` | Sales page | Next.js 16, Tailwind 4, shadcn/ui |

## Run it locally

**Needs:** Node 22+, **npm 11+** (npm 10.9 has a bug installing the backend; use `npx npm@11 install` if needed), and PostgreSQL 16.

```bash
# 1. Database: a user plus two databases (app and tests)
psql -d postgres -c "CREATE ROLE openroles LOGIN PASSWORD 'choose-one' CREATEDB;"
psql -d postgres -c "CREATE DATABASE openroles OWNER openroles;"
psql -d postgres -c "CREATE DATABASE openroles_test OWNER openroles;"
psql -d postgres -c "ALTER ROLE openroles SET timezone TO 'UTC';"   # all times are stored in UTC

# 2. Backend
cd backend
cp .env.example .env          # fill in DATABASE_URL, DATABASE_URL_TEST and API_KEY (openssl rand -hex 32)
npx npm@11 install            # also generates the Prisma client
npx prisma migrate deploy
npm run build
npm run seed:yc -- --find-boards=200   # one-time: import YC companies and find their job boards
npm run jobs:fetch            # one morning run; prints a summary
npm run start:prod            # API on http://localhost:4000/api (try /api/health); also fetches daily at 06:00 IST

# 3. Frontend (another terminal)
cd frontend
cp .env.example .env.local    # API_URL=http://localhost:4000 and the same API_KEY
npx npm@11 install
npm run build && npx next start   # http://localhost:3000
```

To work on the page without the backend: `OPENROLES_SAMPLE_DATA=1 npm run dev`. This shows made-up data in dev only.

## Daily schedule

The API server runs the fetch by itself every day at **06:00 IST**, using NestJS's built-in scheduler (`@nestjs/schedule`). That's the same way mono-backend runs its crons. The code is in `backend/src/schedule/daily-fetch.scheduler.ts`.

- **Missed run:** if the server was down at 06:00, it runs the fetch once when it starts. It does this only if there's been no good run since 06:00 that day.
- **Several API servers:** safe. The database lets only one run start, and the others skip. To keep the cron on one server, set `DISABLE_CRONS=true` on the rest (same flag as mono-backend).
- **Switch it off** on any machine with `DISABLE_CRONS=true`.
- **Always-on host needed:** a run can take up to 90 minutes, so the API must be an always-on server or container (on AWS: ECS or EC2), never a serverless function.
- **On this Mac:** keep the API running (`npm run start:prod`). If the Mac was off at 06:00, the fetch runs when you next start the API.

**Run it by hand** (after `npm run build`):
- `npm run jobs:fetch` runs one full fetch now.
- `npm run boards:import` runs one full fetch with a fresh Common Crawl board import (otherwise the import runs by itself every 30 days).
- `npm run jobs:fetch -- --source=lever` runs one board system only.
- `npm run seed:yc -- --find-boards=N` probes N companies for boards right away. The daily run checks `MAX_COMPANY_PROBES` companies each morning.

## Scripts

| Where | Command | What |
|---|---|---|
| backend | `npm test` | Unit tests (pure logic) |
| backend | `npm run test:e2e` | Integration and API tests on `openroles_test` |
| backend | `npm run lint` / `npm run typecheck` | oxlint / tsc |
| backend | `npm run jobs:fetch` | The daily run (needs `npm run build` first) |
| backend | `npm run jobs:fetch:dev` | Build, then one run |
| frontend | `npm run lint` / `npm run typecheck` / `npm run build` | Checks and production build |

## Settings

All settings are in `backend/.env.example` and `frontend/.env.example`. None of the job sources needs an API key.
- **`API_KEY`** is a secret you generate; it's shared by the frontend and backend, and the frontend uses it server-side only.
- **`TARGET_COUNTRIES`** picks the countries to keep, as ISO codes (`IN,AE,US`). The default `ALL` keeps every country.
- **`MAX_BOARDS_PER_RUN`** caps the boards read in one run (default 20,000).
- **`LINKEDIN_ENABLED=true`** reads LinkedIn's logged-out job search (approved). `LINKEDIN_MAX_REQUESTS` caps the requests per morning (default 300). The lane stops for the day if LinkedIn blocks us.
- **`LINKEDIN_PROVIDER`**: `apify` reads LinkedIn through Apify's `curious_coder/linkedin-jobs-scraper`, paid per job. It needs `APIFY_TOKEN`. `APIFY_LINKEDIN_DAILY_LIMIT` (default 50) caps the jobs per day and `APIFY_MAX_COST_USD` caps each run. `guest` is our own free logged-out reader.
- **`DISABLE_CRONS=true`** stops this API server from running the 06:00 IST fetch (default: it runs).

## Deploying (not done yet)

- **Target: AWS.**
- **`backend/Dockerfile`** builds one image. Run `npx prisma migrate deploy` once per release, then start the API (`node dist/main.js`) as an always-on service. It also runs the 06:00 IST fetch.
- **The frontend** can go on Vercel or the same host.
- **No CI pipeline** (removed 26 Nov 2026, not needed). Run the checks locally before pushing (see Scripts).
- **Still to decide:** how salespeople log in.
