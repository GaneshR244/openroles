# OpenRoles

An internal tool that shows Hyring's sales team which companies are hiring, for which role, with a link to the live job post. Every morning a script collects new public job posts for India, the UAE and the US, saves each role once, and a sales page lists them.

- What and why: [`REQUIREMENTS.md`](REQUIREMENTS.md)
- How it works (HLD + LLD): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Build log: [`docs/PROGRESS.md`](docs/PROGRESS.md)
- Rules for contributors and Claude Code: [`CLAUDE.md`](CLAUDE.md)

## How it fits together

```
cron 06:00 IST ──▶ backend fetch script ──▶ public job boards (no API keys)
                          │                  Greenhouse · Lever · Ashby · SmartRecruiters · Workable
                          ▼                  (+ LinkedIn, switched off until approved)
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
npm run start:prod            # API on http://localhost:4000/api (try /api/health)

# 3. Frontend (another terminal)
cd frontend
cp .env.example .env.local    # API_URL=http://localhost:4000 and the same API_KEY
npx npm@11 install
npm run build && npx next start   # http://localhost:3000
```

To work on the page without the backend: `OPENROLES_SAMPLE_DATA=1 npm run dev`. This shows made-up data in dev only.

## Daily schedule

The fetch must run on an always-on server or container, because a run can take up to 90 minutes. It can't run as a serverless function. Times are UTC:

```cron
30 0 * * *  cd /app/backend && node dist/scripts/fetch-jobs.js --trigger=cron   # 06:00 IST
```

On Kubernetes, use a CronJob with `concurrencyPolicy: Forbid`. A second run started by mistake exits on its own anyway: the database allows only one running run at a time.

**Useful flags:**
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
- **`TARGET_COUNTRIES`** picks the markets (default `IN,AE,US`).
- **`LINKEDIN_ENABLED`** stays `false` until the lead approves LinkedIn.

## Deploying (not done yet)

- **`backend/Dockerfile`** builds one image for both the API and the script. Run `npx prisma migrate deploy` once per release, then the API (`node dist/main.js`), plus the cron line above.
- **The frontend** can go on Vercel or the same host.
- **CI** (`.github/workflows/ci.yml`) lints, typechecks, tests and builds both apps.
- **Still to decide:** hosting, and how salespeople log in.
