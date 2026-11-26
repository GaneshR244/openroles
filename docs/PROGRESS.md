# OpenRoles: build progress

Running log of what was built, the checks that passed, and any decision made along the way.
Branch: `build/v1` (local only, nothing pushed). One commit per phase.

**Mode.** The user authorized continuous building on 25 Nov 2026: phases run back to back without stopping for review. Phase 10 (LinkedIn) is skipped until the lead's OK. Real deployment waits for a hosting decision.

---

## Phase 1: Repo and skeleton (done)

**Built**
- **Git repo** on branch `build/v1`.
- **Local PostgreSQL 16:** role `openroles` (random password, stored only in `backend/.env`), databases `openroles` and `openroles_test`. The existing `hyring` database was not touched.
- **`backend/`:** NestJS 12, created with the official CLI.
  - Typed and validated settings (`src/config/env.ts`, zod), `PrismaModule`/`PrismaService` (Prisma 7 + `@prisma/adapter-pg`), helmet, CORS, `/api` prefix.
  - `GET /api/health` reports the database status.
  - Prisma schema exactly as in architecture §3.2, plus the extra SQL migration: pg_trgm search indexes and the partial unique index that allows only one RUNNING run.
- **`frontend/`:** Next.js 16 (App Router), Tailwind 4, shadcn/ui with the components the page needs. Placeholder home page.
- `.env.example` files, `docker-compose.yml` (PostgreSQL only; untested, no Docker on this machine).

**Checks**
- backend: typecheck ✔ · lint (oxlint) ✔ · unit tests 4/4 ✔ · e2e tests 3/3 ✔
  - The e2e tests confirm they run on `openroles_test`, never the dev database.
- frontend: typecheck ✔ · lint ✔ · production build ✔

**Differences from the architecture doc** (doc updated to match)
- **Tooling:** NestJS 12 is ESM-only, and its template uses Vitest and oxlint instead of Jest and ESLint. We kept the template's tools. Relative imports end in `.js`.
- **Request validation:** Nest 12 validates with zod directly (`StandardSchemaValidationPipe`), so `class-validator`/`class-transformer` are not needed. zod covers both external responses and request validation.
- **Prisma 7:**
  - `prisma.config.ts` (it loads `.env` with Node's built-in `process.loadEnvFile`, so no dotenv package)
  - a generated client in `src/generated/prisma` (git-ignored, built by `postinstall`/`build`)
  - a driver adapter
  - The `latest` npm tag for Prisma points at an 8.0 release candidate; we use the stable 7.10.1.
- **`jobs:fetch:dev`** builds, then runs the compiled script. ts-node doesn't work well with ESM.
- **Health endpoint** lives in `src/health/`.
- **Removed from the templates:**
  - `@nestjs/observe`: third-party telemetry that sends data to observe.nestjs.com; not approved.
  - `@nestjs/mau`: Nest's hosting platform.
  - The agent-skill folders the Nest CLI and `prisma init` added (`.agents`, `.claude`, `.windsurf`). We keep one set of project rules. Next.js's own `frontend/AGENTS.md` stays, because `next dev` re-creates it.
- **npm:** npm 10.9 crashes resolving Vitest's peer dependencies ("Cannot read properties of null (reading 'edgesOut')"). Installs use npm 11 (`npx npm@11 install`). npm 11 blocks install scripts by default; only `@prisma/engines` is approved.

---

## Phases 2–9 and 11 (non-deploy): done, 25 Nov 2026

Built in waves. Three agents worked in parallel on separate folders (pipeline helpers, HTTP client and readers, sales page) while the core logic was written in the main session. An independent reviewer agent then checked everything, and its findings were fixed.

| Phase | Commit | What |
|---|---|---|
| 2 | `583fef1` | Pipeline helpers: normalize, fingerprint, country, work mode, filter, IST time (213 tests) |
| 3 | `bfbdab8` | HTTP client (per-host limits, retry, breaker, host blocking) and 5 readers, tested on saved real responses |
| 4 | `388c612` | Job store: batched dedupe, touch before filter, chunked inserts, set-difference close |
| 5 | `ec8403a` | Board lane: adaptive polling 1→2→4→7 days, change hash, empty and truncated guards |
| 6 | `4c902d3` | Board finder (verified slug probes) and YC import |
| 7 | `41dfcf4` | Orchestrator: lease lock, heartbeat, deadline, retention, reporter, scripts |
| 8 | `8dbd5a7` | Read API: jobs, companies, company page, latest run; API-key guard; zod validation |
| 9 | `adc0571` | Sales page: views, filters in the URL, tables, company page, banner |
| 11 | `793bc35` | Dockerfile, CI workflow, Prisma CLI as a runtime dependency (no deploy yet) |
| review | `a10c790` | Fixes from the independent review and the first live runs (below) |

**Checks**
- backend: typecheck ✔ · lint ✔ · 310 unit tests ✔ · 35 integration and API tests on real PostgreSQL ✔
- frontend: typecheck ✔ · lint ✔ · production build ✔

**Live runs on this machine (real data)**
- YC import: 6,408 companies, 1,458 hiring.
- Board finder: 300 companies checked so far → 75 verified boards, mostly Ashby (YC startups).
- Morning run 1: SUCCESS in 48 s, 137 new roles.
  - Most dropped jobs were posted more than 30 days ago ("evergreen" posts); 39 were outside our markets.
- **No duplicates (acceptance):** all 63 boards re-read the same day → all unchanged, 0 new, 0 closed, job count unchanged, every job's "last seen" refreshed, and intervals doubled to 2 days.
- Run 3 (after the fixes): finder +14 boards, 24 new roles.
- **Now:** 160 open roles at 37 companies, mostly US. India and UAE coverage stays thin until LinkedIn is switched on, as expected.
- API (`/api/*`, needs the key) and the sales page both verified against real data. The API key appears in neither the page HTML nor the client JavaScript.

**Fixes from the independent review and the live runs**
- **Reposts:** a role reposted with a new ID (or one of two same-title openings closing) was wrongly closed. Rows are now relinked to the live posting, and a role whose fingerprint is still listed is never closed.
- **Run robustness:**
  - One failing item can't fail the run.
  - Failed runs alert Slack.
  - A reporting error can't flip a finished run to FAILED.
- **Readers:** an empty page before the end of paging is reported as truncated, so nothing is closed.
- **Board failures:**
  - Timeouts, network errors and 5xx no longer count against a board; only 404s, changed formats and other 4xx do.
  - A BROKEN board closes its jobs, is retried weekly, and reopens its jobs when it works again.
- **API:**
  - Board jobs not confirmed for 8 days are hidden.
  - Health returns 503 when the database is down.
  - Run status includes the second board pass.
- **Same-name companies:** the board finder now keeps one board per company and rejects boards whose job links point to another company's website. Two wrong matches from the first run (Weave, Mosaic) were removed.
- **Migrations:** Prisma tried to drop the trigram search indexes because they weren't declared in the schema. They are now declared, and a drift check comes back empty. The (status, postedAt) index was added.
- **Database timezone:** set to UTC for the `openroles` role. The app was already timezone-safe; this protects manual SQL.

**Notes for the next session**
- **Workable is blocking this machine for about 24 hours** (HTTP 429, Retry-After 86081 s), triggered by the readers agent's testing. The client now stops calling a host that sends a long Retry-After, and the finder never probes Workable.
- **Workable discovery is limited:** Workable boards are only read once added. The finder doesn't guess Workable slugs.

## Phase 10: LinkedIn (done, 25 Nov 2026)
Approved by the user. Built and switched on (`LINKEDIN_ENABLED=true`).
- **Built:**
  - `linkedin.parser.ts` (cheerio, selectors verified live)
  - `linkedin-lane.service.ts`: fair-share budget across 20 cities, paging, a run-level seen set, saves every 100 cards, saturation flag, and stops for the day on a rate limit or bot-check page
  - Wired into the orchestrator in parallel with the board lane
- **Tests:** 13 unit tests (parser plus lane) and 1 integration test on PostgreSQL (saved once, company spellings merged, second run adds 0).
  - backend totals: 323 unit, 36 integration and API tests, all passing.
- **First real run** (budget 60 requests): PARTIAL in 4 min.
  - LinkedIn made **23 requests and read 220 cards, saving 216 new jobs (149 India, 30 UAE, 37 US)** from **182 new companies**. Then LinkedIn blocked the laptop and the lane stopped cleanly. The board lane and the finder carried on.
  - The board finder then found 6 boards for LinkedIn companies, adding 206 more roles (mostly India on SmartRecruiters).
  - Run total: 422 new roles. Database check: 0 duplicate fingerprints, 0 duplicate source + job IDs.
- **Now:** 582 roles first seen today at 221 companies (India 228, UAE 33, US 313). The sales page shows them; the UAE filter was checked.
- **What to watch:** this laptop gets bot-checked after roughly 20–25 LinkedIn requests in one go, so a morning run will usually stop well before its 300-request budget, at about 200 jobs a day. If that holds, try slower pacing for LinkedIn (a longer gap in `host-policies.ts`). Never try to get around the block.

## Daily cron inside the API (done, 25 Nov 2026)
Decision with the user: we deploy on AWS, and mono-backend runs its crons with `@nestjs/schedule` (45 `@Cron` jobs, `DISABLE_CRONS` switch), so OpenRoles does the same. Details are in ARCHITECTURE.md, "As built: daily schedule".
- **Built:**
  - `src/schedule/daily-fetch.scheduler.ts`: `@Cron('0 0 6 * * *', { timeZone: 'Asia/Kolkata' })` calls the orchestrator. At start-up it catches up a missed 06:00 run. A failed run is logged and never crashes the API.
  - `DailyFetchModule`, imported by `AppModule`
  - `DISABLE_CRONS` setting (default false). Tests force it to true.
- **Removed:** the macOS launchd file. Keeping the API running now covers the laptop case.
- **Tests:** 5 unit (catch-up rule, India calendar day) and 7 integration (job registered for 06:00 IST, catch-up runs or skips, failure doesn't throw, the switch works).
  - backend totals: 328 unit and 43 integration/API tests, all passing.
  - lint, typecheck and build are clean.
- **Live check:** the API was restarted and logged "daily fetch scheduled for 06:00 IST". There was no catch-up because today's 15:40 run counts.

## Every country, Common Crawl board import, sales page upgrades (done, 26 Nov 2026)
Asked by the user: remove the country limit, and find "all companies" on Greenhouse, Lever and Ashby the way other job scrapers do.
- **Every country:**
  - `Job.country` is now any ISO code; the migration changed the column in place, with no data lost.
  - `TARGET_COUNTRIES=ALL` is the default (local `.env` switched to ALL). A list still narrows it.
  - World country names, aliases and about 300 big cities are in `pipeline/world-places.ts`.
- **Common Crawl board import:** see ARCHITECTURE.md, "As built: Common Crawl board import". It runs inside the morning run every 30 days, or on demand with `npm run boards:import`.
- **Sales page:**
  - a country filter you can type in, with counts
  - a totals line (roles · companies · countries) from the new `GET /api/summary`
  - rows per page (10, 25, 50 or 100)
- **Locations** are tidied in the pipeline ("Hyderabad, , India" → "Hyderabad, India"). A one-off script fixed 10,491 saved jobs and recomputed their fingerprints.
- **Tests:** backend 374 unit and 54 integration/API tests, all passing. Lint, typecheck and builds are clean for both apps.
- **First import run (26 Nov, 08:27–09:07 IST, PARTIAL only because LinkedIn blocked us):**
  - Common Crawl: 2 crawls, 61 index pages, 8,230 boards found. 8,200 checked: 6,391 added, 649 with no open jobs, 1,158 gone. The import is complete, so the next one is due in 30 days.
  - Three index pages answered HTTP 400 and were skipped.
  - Boards now: Greenhouse 3,839 · Ashby 1,536 · SmartRecruiters 916 · Lever 196.
  - 136,482 new roles and 6,211 new companies in 40 minutes. Open roles: 137,506 at 5,585 companies in 174 countries (US 65,818 · UK 8,568 · France 8,112 · Germany 7,339 · Canada 4,823 · India 4,039 · UAE 756; 7,651 with no country we can tell).
- **To watch:**
  - Lever is thin in Common Crawl (196 boards). Scanning more crawls would find more.
  - Normal daily runs should take 10–20 minutes, because quiet boards are read less often.

## LinkedIn through Apify (done, 26 Nov 2026)
The lead asked to take LinkedIn jobs from Apify (`curious_coder/linkedin-jobs-scraper`) instead of our own reader. We use the free plan.
- **Built:**
  - `linkedin-apify.service.ts`: start one capped run, wait, read the dataset, then save through the normal pipeline.
  - `sources/apify-linkedin.ts`: search links, input, item mapping, daily remaining.
  - zod schemas for the run and the items, plus an `api.apify.com` host policy.
- **Settings:** `LINKEDIN_PROVIDER=apify` (local `.env`), `APIFY_TOKEN` (in `.env`, git-ignored), `APIFY_LINKEDIN_DAILY_LIMIT=50`, `APIFY_MAX_COST_USD=0.15`.
- **Cost:** about $0.10 a day, $3 a month, inside the free $5. The free plan can't overspend.
- **Tests:** 9 unit tests (input, limits, mapping from a fixture shaped like the actor's sample) and 5 integration tests (capped start never retried, token in a header, saved jobs, today's limit, no token, aborting a stuck run). They use fake Apify responses, so nothing is spent.
  - Backend totals: 384 unit and 59 integration/API tests, all passing.
- **Not run live yet,** on purpose. The first real run is the 06:00 IST cron tomorrow (50 jobs, about $0.10). After it, save a real response as the fixture.

## Not done yet
- **Deployment:** AWS is decided. The API (with its cron) needs to be deployed as an always-on service.
- **Sales login:** not wanted for now (user, 25 Nov 2026). The page is view-only.

## Running locally right now
- **Sales page:** http://localhost:3001 · **API:** http://localhost:4000/api/health (also fetches daily at 06:00 IST)
- **Another fetch:** `cd backend && npm run jobs:fetch` · **probe more companies:** `npm run seed:yc -- --find-boards=200`
