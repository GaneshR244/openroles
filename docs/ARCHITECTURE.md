# OpenRoles: Architecture (HLD + LLD)

Status: approved plan, not built yet. Version 1, 25 Nov 2026.
The plain-language requirement is in `../REQUIREMENTS.md`. Visual version: https://claude.ai/artifact/QUqYRP2myQixsoZP8uFsSi

This document is the source of truth for building OpenRoles. If code and this document disagree, fix one of them in the same change.

---

## As built: tooling notes (phase 1, 25 Nov 2026)
These override older wording below where they differ.
- **NestJS 12 is ESM-only.** Relative imports end in `.js`. Tests use **Vitest** (not Jest) and lint uses **oxlint**: the Nest 12 template defaults.
- **Request validation** uses zod via Nest's `StandardSchemaValidationPipe`. `class-validator` is not used, so "DTO" below means a zod schema.
- **Prisma 7.10:**
  - `prisma.config.ts` holds the config.
  - The `prisma-client` generator outputs to `src/generated/prisma` (git-ignored).
  - `PrismaService` uses the `@prisma/adapter-pg` driver adapter.
- **Scripts run compiled:** `jobs:fetch:dev` = `nest build` + `node dist/scripts/fetch-jobs.js`.
- **Health endpoint** lives in `src/health/health.controller.ts`.
- **Tests:**
  - Unit: `src/**/*.spec.ts`.
  - Integration and e2e: `test/**/*.int-spec.ts` and `test/**/*.e2e-spec.ts` against `openroles_test`. The global setup runs `prisma migrate deploy`.
- **npm ≥ 11 is required** (npm 10.9 crashes resolving Vitest peers).

## As built: behaviour decisions (phases 2–9, 25 Nov 2026)
- **Country (§3.6).**
  - Structured codes win when they contain a target. Otherwise the location text is checked; OUT only if both fail.
  - The "City, ST" rule only accepts US state codes that are not also ISO country codes (TX, NY, WA, …). Ambiguous codes (CA, IL, DE, IN, …) need a known US city, so "Berlin, DE" and "Tel Aviv, IL" are OUT.
  - Pakistan indicators (pakistan, sindh, karachi, lahore, islamabad, rawalpindi, code PK) turn off the Hyderabad/Punjab → India match.
  - Dotted initials are joined before suffix stripping ("L.L.C." → "llc").
  - In text, hybrid beats remote.
- **Readers** return `{ jobs, truncated }`.
  - `truncated` is true only when paging stopped at the cap with more left (SmartRecruiters 20 pages, Workable 50).
  - A truncated read saves new jobs but never closes any, and never sets the change-detection hash.
- **Host blocking.**
  - A 429 with a Retry-After longer than the host's retry cap blocks that host for the rest of the run (BlockedError, no request). Three consecutive 429s do the same on every ATS host.
  - These host-level errors don't count as board failures: the board is retried tomorrow and never marked BROKEN because of them.
- **Workable:**
  - Polite policy: 1 request at a time, 1.5–2.5 s apart.
  - The board finder does **not** probe Workable slugs, because Workable rate-limits bursts for about 24 h. Workable boards can be added by hand or found from links later.
- **Run status:** PARTIAL means the deadline was hit, LinkedIn was blocked, or more than 10% of due boards failed. A few failing boards is normal noise and stays SUCCESS, with the details in `stats.boards.errors`.
- **API:** `GET /api/runs/latest` also returns `today: { newJobs, companies }`, live counts for the banner.
- **Frontend:**
  - Next 16 `cacheComponents` and partial prerendering.
  - `lib/api.ts` is `server-only`.
  - `OPENROLES_SAMPLE_DATA=1` shows made-up data in dev only; production builds ignore it.

## As built: LinkedIn lane (phase 10, 25 Nov 2026)
- **Status:** approved by the user and switched on (`LINKEDIN_ENABLED=true`).
- **Parser:** `sources/linkedin.parser.ts` (cheerio). Selectors were verified live.
  - A non-empty page with no job cards (LinkedIn's bot-check script) counts as **blocked**: the lane stops for the day and never tries to get around it. An empty body means the end of results.
- **Lane:** `linkedin-lane.service.ts`.
  - **Budget:** split fairly, `floor(budget / searches)` pages per city in pass 1, then leftover requests in priority order.
  - **Paging:** `start` moves forward by the cards returned. A 400 past the first page ends that search.
  - **Duplicates and saving:** a run-level Set skips postings already seen in another city. Jobs are saved every 100 cards with the search's country.
  - **Limits:** at 1,000 results a search is marked saturated.
  - **Running:** it runs in parallel with the board lane. LinkedIn retries a 429 only once, then stops.

## As built: daily schedule (25 Nov 2026)
This replaces the original D1 ("a batch script started by an outside cron").
- **Why:** we deploy on AWS, and mono-backend runs all its crons (45 `@Cron` jobs) with `@nestjs/schedule` inside the app, switched off per server with `DISABLE_CRONS=true`. Using the same pattern means nothing new for DevOps. The usual risks of in-app crons are already covered here: the FetchRun lease lets only one run start across servers; a run killed by a restart frees its lease after 10 minutes, keeps what it saved, and the next run catches up.
- **How:** `src/schedule/daily-fetch.scheduler.ts` has one `@Cron('0 0 6 * * *', { timeZone: 'Asia/Kolkata' })` that calls `RunOrchestratorService.run({ trigger: 'cron' })`. `DailyFetchModule` (`ScheduleModule.forRoot()` + `IngestionModule`) is imported by `AppModule`.
- **Catch-up:** at API start-up, if it's past 06:00 IST and no SUCCESS/PARTIAL run has started since 06:00 that day, one run starts in the background. This covers a server that was down or restarting at 06:00.
- **Off switch:** `DISABLE_CRONS=true` skips both the 06:00 tick and the catch-up. Tests set it, so booting `AppModule` never starts a real run.
- **Manual runs:** unchanged. `npm run jobs:fetch` boots `IngestionModule` on its own and shares the same lease.
- **Later option:** if the run grows long or heavy, move it to EventBridge Scheduler → ECS RunTask with the same image and `node dist/scripts/fetch-jobs.js --trigger=cron`, and set `DISABLE_CRONS=true` on the API. No code change is needed.

## 0. Scope

**In scope (v1)**
- A daily batch job that collects public job posts for India, the UAE and the US.
- All roles, all company sizes, all work types (onsite, hybrid, remote). Recruitment agencies are included.
- Storage of a few fields per job, deduplicated.
- A read-only API.
- One sales page.

**Non-goals (v1)**
- Job descriptions, salary, skills, experience
- LLM parsing
- Queues or Redis
- Headless browsers or proxies
- Logged-in LinkedIn access
- Fuzzy company matching
- Writing to Close CRM

---

## 1. Requirements

### Functional
- F1: Every day at 06:00 IST, collect new public job posts from LinkedIn (behind a switch) and five ATS systems: Greenhouse, Lever, Ashby, SmartRecruiters and Workable.
- F2: Per job, store: company, title, location, country (IN | AE | US, or null for plain remote), work mode, live URL, posted date, source, and the source's job ID.
- F3: Never store the same job twice. Show each job as "new" exactly once.
- F4: Keep out jobs posted more than 30 days ago. Mark jobs closed when they disappear from a company board.
- F5: Find company boards automatically. Sales has no target list.
- F6: The sales page has three views (New today, Last 7 days, All open), filters (country, source, work mode, search), and two layouts (by job, by company).

### Non-functional
| ID | Requirement | Target |
|---|---|---|
| N1 | Run finishes before the team starts at 08:00 IST | ≤ 90 min (deadline), typical 30–45 min |
| N2 | Idempotent | A rerun never creates duplicates |
| N3 | Partial failure | One board or source failing never stops the run |
| N4 | Correctness over coverage | A source that can't be read reliably is skipped and reported |
| N5 | Polite to sources | Per-host rate limits and backoff; never bypass blocks |
| N6 | Observable | Every run writes a report; Slack alert on failure or anomaly |
| N7 | Simple | Two apps, one database, one cron, few dependencies |

### Capacity estimates (v1)
- **Boards:** about 1–3k after the YC seed, growing 50–100 a day from LinkedIn discovery. Adaptive polling keeps the boards due each day to about 40–60%.
- **Requests per run:**
  - Boards: one per due board. SmartRecruiters and Workable page, capped at 20 pages each.
  - LinkedIn: at most `LINKEDIN_MAX_REQUESTS`, default 300.
  - Board finder: at most `MAX_COMPANY_PROBES` × 4 slugs × 5 ATS, default 100 companies. It stops at the first verified match per ATS.
- **Rows:** about 50k–200k active jobs and under 1M total with retention. Under 1 GB. Trivial for PostgreSQL.
- **Run time:**
  - Board lane: about 3k × 0.5 s ÷ 5 workers ≈ 5–10 min.
  - LinkedIn lane: 300 × ~3.5 s ≈ 18 min. It runs in parallel with the board lane.
  - Board finder: about 5 min.

---

## 2. High-level design (HLD)

### 2.1 Containers
```
@Cron 06:00 IST (in the API) ──starts──▶ fetch run (same code as the manual script `fetch-jobs.ts`)
                                 │  reads public JSON/HTML (no API keys)
                                 ▼
               LinkedIn guest search · Greenhouse · Lever · Ashby · SmartRecruiters · Workable · YC list
                                 │
                                 ▼  batched SQL (Prisma)
                            PostgreSQL ◀──reads── backend: NestJS API (always on, /api/*)
                                                        ▲
                                     GET /api/* + x-api-key (server-side)
                                                        │
                                   frontend: Next.js (RSC) + Tailwind + shadcn/ui ◀── sales team (browser)
```
- The fetch script is the only component that calls the internet.
- The API is read-only. The frontend never talks to the database.

### 2.2 Components
| Component | Responsibility |
|---|---|
| Run orchestrator | Takes the lease (one run at a time), sets the time window and deadline, runs the lanes, writes the run report |
| LinkedIn lane | Searches by city with the "posted since" window; parses job cards; sequential and rate-limited |
| Board lane | Reads every due board, 5 workers in parallel; change detection; closes removed jobs |
| Board finder | Finds ATS boards for companies we know (slug guesses + verified probes) |
| Pipeline | Parse → normalize → resolve country and work mode → filter → batch dedupe → job store |
| Job store | Touch known jobs, insert new jobs, close removed jobs, all with batched SQL |
| Retention | Deletes jobs unseen for 90 days, in batches |
| Reporter | FetchRun stats, Slack summary, anomaly check |
| API | Read-only endpoints for the page; API-key guard; DTO validation |
| Frontend | Server-rendered page with filter state in the URL |

### 2.3 Key decisions
| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| D1 | A `@nestjs/schedule` cron inside the API (06:00 IST), plus a manual script; see "As built: daily schedule" | Same pattern as mono-backend on AWS; the FetchRun lease makes it safe with several servers; easy to rerun by hand | BullMQ + Redis: more moving parts. EventBridge → ECS task: kept as a later option |
| D2 | Dedupe with PostgreSQL unique indexes + `ON CONFLICT DO NOTHING` | The database is the single source of truth, so dedupe is idempotent under reruns and crashes | In-memory caches or Bloom filters: state lost on crash; not needed at under 1M rows |
| D3 | Closed jobs = set difference per board | One request per board shows every open job | Checking each job URL: thousands of extra requests |
| D4 | Adaptive polling (1→2→4→7 days when unchanged) | Run time stays bounded as boards grow | Fixed daily polling: run time grows linearly |
| D5 | Lease lock: partial unique index + heartbeat | Crash-safe and works with Prisma's connection pool | `pg_advisory_lock`: session-level, unreliable with pooled connections |
| D6 | Exact normalized-name matching | No false merges of different companies | Fuzzy matching (Levenshtein/Jaro-Winkler): wrong merges are worse than duplicates |
| D7 | Native `fetch` + zod response schemas | Few dependencies; detects API shape changes immediately | axios without schemas: silent breakage |
| D8 | Offset pagination | Page numbers in the UI; fine below about 100k rows per view | Keyset pagination: switch later if views grow |
| D9 | NestJS API + Next.js UI as separate apps | The team's choice; ingestion needs a long-running process | Next.js-only: serverless time limits |
| D10 | No headless browser, proxies or login | Legal/ToS risk and cost; LinkedIn guest HTML is enough | Puppeteer + proxy pools |

---

## 3. Low-level design: backend

### 3.1 Module layout (`backend/src`)
```
main.ts                      API bootstrap (helmet, CORS, validation pipe, /api prefix)
app.module.ts
config/                      typed env config (validated at boot)
prisma/                      PrismaModule, PrismaService
common/
  http/http-client.ts        fetch + timeout + per-host limiter + retry + circuit breaker
  http/host-policies.ts      per-host concurrency and min gap
  guards/api-key.guard.ts    timing-safe compare
  time.ts                    IST day boundaries
ingestion/
  ingestion.module.ts
  run-orchestrator.service.ts   lease, window, deadline, lanes, report
  linkedin-lane.service.ts      search plan, pagination, budget, breaker
  board-lane.service.ts         due boards, worker pool, change detection, closing
  board-finder.service.ts       slug guesses, probes, verification
  job-store.service.ts          touch, insert, close (batched)
  retention.service.ts
  reporter.service.ts           stats, Slack, anomaly check
  pipeline/
    normalize.ts                text, company, title, location; fingerprint
    country.ts                  resolveCountry(), dictionaries
    work-mode.ts                resolveWorkMode()
    filter.ts                   age, country, required fields, blocklist
  sources/
    source.types.ts             RawJob, BoardReader interface
    greenhouse.reader.ts
    lever.reader.ts
    ashby.reader.ts
    smartrecruiters.reader.ts
    workable.reader.ts
    linkedin.parser.ts          HTML card parser (cheerio)
    schemas.ts                  zod schemas per source
  sources.config.ts             LinkedIn searches, blocklist
jobs/                           API: controller, service, DTOs, raw SQL for the companies view
schedule/
  daily-fetch.scheduler.ts      @Cron 06:00 IST + start-up catch-up (DISABLE_CRONS switches off)
  daily-fetch.module.ts
scripts/
  fetch-jobs.ts                 manual run (same orchestrator)
  import-yc.ts                  one-time seed
```

### 3.2 Data model
```prisma
// Keep the generator and datasource blocks that `prisma init` creates.

enum Ats { GREENHOUSE LEVER ASHBY SMARTRECRUITERS WORKABLE }
enum JobSource { LINKEDIN GREENHOUSE LEVER ASHBY SMARTRECRUITERS WORKABLE }
enum Country { IN AE US }
enum WorkMode { ONSITE HYBRID REMOTE UNKNOWN }
enum JobStatus { ACTIVE CLOSED }
enum BoardStatus { ACTIVE BROKEN }
enum RunStatus { RUNNING SUCCESS PARTIAL FAILED }

model Company {
  id              String    @id @default(cuid())
  name            String                // display name as first seen
  normalizedName  String    @unique     // dedupe key
  website         String?               // from YC; used for slug guesses
  linkedinUrl     String?
  discoveredVia   String                // linkedin | yc | board | manual
  boardsCheckedAt DateTime?             // last board-finder probe
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  boards          Board[]
  jobs            Job[]
}

model Board {
  id                String      @id @default(cuid())
  ats               Ats
  slug              String                  // e.g. "cred" in jobs.lever.co/cred
  status            BoardStatus @default(ACTIVE)
  failCount         Int         @default(0) // consecutive failures; 3 → BROKEN
  emptyCount        Int         @default(0) // consecutive empty responses (guard)
  fetchIntervalDays Int         @default(1) // adaptive: 1, 2, 4, 7
  nextFetchAt       DateTime    @default(now())
  lastFetchedAt     DateTime?
  lastJobsHash      String?                 // sha1 of sorted external IDs
  openJobs          Int         @default(0)
  createdAt         DateTime    @default(now())
  companyId         String
  company           Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  jobs              Job[]

  @@unique([ats, slug])
  @@index([status, nextFetchAt])
}

model Job {
  id          String    @id @default(cuid())
  source      JobSource
  externalId  String
  fingerprint String    @unique             // sha1(company | title | location)
  title       String
  location    String?
  country     Country?                      // null = plain "Remote" kept by the board rule
  workMode    WorkMode  @default(UNKNOWN)
  url         String
  postedAt    DateTime                      // source date, or first-seen time if missing
  firstSeenAt DateTime  @default(now())     // drives "New today"
  lastSeenAt  DateTime  @default(now())
  closedAt    DateTime?
  status      JobStatus @default(ACTIVE)
  companyId   String
  company     Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  boardId     String?                       // null for LinkedIn jobs
  board       Board?    @relation(fields: [boardId], references: [id], onDelete: SetNull)

  @@unique([source, externalId])
  @@index([firstSeenAt(sort: Desc)])
  @@index([status, country, postedAt(sort: Desc)])
  @@index([boardId, status])
  @@index([companyId, status])
  @@index([lastSeenAt])
}

model FetchRun {
  id          String    @id @default(cuid())
  status      RunStatus @default(RUNNING)
  trigger     String    @default("cron")    // cron | manual
  startedAt   DateTime  @default(now())
  heartbeatAt DateTime  @default(now())
  finishedAt  DateTime?
  stats       Json?
  error       String?

  @@index([status, startedAt(sort: Desc)])
}
```

Extra SQL, added in a migration:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX job_title_trgm    ON "Job"     USING gin (title gin_trgm_ops);
CREATE INDEX company_name_trgm ON "Company" USING gin (name  gin_trgm_ops);
-- Lease: at most one RUNNING run can exist
CREATE UNIQUE INDEX fetch_run_single_running ON "FetchRun" ((true)) WHERE status = 'RUNNING';
```

### 3.3 Sources (verified live on 25 Nov 2026)

```ts
type RawJob = {
  source: JobSource; externalId: string; title: string; companyName: string;
  companyLinkedinUrl?: string;
  locations: string[];                 // all locations as text
  countryCodes?: string[];             // structured ISO codes when the source gives them
  workModeHint?: string;               // structured work type when given
  url: string; postedAt?: Date;
};
interface BoardReader { ats: Ats; read(slug: string): Promise<RawJob[]> }   // throws typed errors
```

| ATS | Request | Mapping (verified fields) |
|---|---|---|
| Greenhouse | `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs` | id → externalId · title · company_name · location.name → locations · absolute_url → url (may be the company's own site) · first_published ?? updated_at → postedAt. Country and work mode from text. |
| Lever | `GET https://api.lever.co/v0/postings/{slug}?mode=json`; on 404 retry `api.eu.lever.co`; check the content-type is JSON | id · text → title · categories.allLocations / categories.location → locations · **country** (ISO2, e.g. "IN") → countryCodes · **workplaceType** (onsite/hybrid/remote) → workModeHint · hostedUrl → url · createdAt (epoch ms) → postedAt |
| Ashby | `GET https://api.ashbyhq.com/posting-api/job-board/{slug}`; keep `isListed` only | id · title · location + secondaryLocations → locations · **address.postalAddress.addressCountry** (e.g. "USA") → countryCodes · **workplaceType** (OnSite/Hybrid/Remote) + isRemote → workModeHint · jobUrl → url · publishedAt |
| SmartRecruiters | `GET https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset={n}`, page until totalFound, max 20 pages; IDs are case-sensitive | id · name → title · company.name · location.fullLocation → locations · **location.country** (ISO2 lowercase) → countryCodes · **location.remote / location.hybrid** → workModeHint · url = `https://jobs.smartrecruiters.com/{slug}/{id}` · releasedDate |
| Workable | `POST https://apply.workable.com/api/v3/accounts/{slug}/jobs`, body `{"query":"","location":[],"department":[],"worktype":[],"remote":[]}`; follow the `nextPage` token (send `{"token": nextPage}` in the next body; confirm against a fixture), max 20 pages. GET returns 404. | shortcode → externalId · title · locations[].city/country → locations · **location.countryCode** → countryCodes · **workplace** (on_site/hybrid/remote) → workModeHint · url = `https://apply.workable.com/{slug}/j/{shortcode}/` · published |
| LinkedIn | `GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=&location={city}&f_TPR=r{seconds}&start={n}` | HTML cards via cheerio: `data-entity-urn` "urn:li:jobPosting:{id}", `.base-search-card__title`, `.base-search-card__subtitle a` (name + company link, strip the query), `.job-search-card__location`, `time[datetime]`. url = `https://www.linkedin.com/jobs/view/{id}`. Country = the search's country. Work mode from text, else UNKNOWN. |
| YC list | `GET https://yc-oss.github.io/api/companies/all.json` | name, website, isHiring. Seed only. |

Every reader validates the response with a zod schema in `schemas.ts`. A mismatch throws `SchemaChangedError`, which is reported and alerted. Fixtures live in `test/fixtures/{ats}.json`. Tested boards: Greenhouse "stripe", "groww"; Lever "cred"; Ashby "ramp"; SmartRecruiters "Freshworks"; Workable "huggingface".

### 3.4 HTTP client (`common/http`)
- **Timeouts:** `AbortController`. Default 10 s; board-finder probes 3 s. Response size cap 20 MB.
- **Per-host limiter:** a semaphore (max concurrency) plus a minimum gap between request starts.
  | Host | Concurrency | Min gap |
  |---|---|---|
  | `www.linkedin.com` | 1 | random 2,000–5,000 ms (jitter) |
  | ATS API hosts | 4 each | 100 ms |
  | `yc-oss.github.io` | 1 | 0 |
- **Retry:** on network error, timeout, 429 and 5xx. Up to 3 attempts. Delay = `Retry-After` if present, else full jitter `random(0, min(cap, base · 2^attempt))`, with base 1 s and cap 30 s (LinkedIn: base 30 s, cap 120 s). 4xx other than 429 is not retried (404 → `NotFoundError`).
- **Circuit breaker (LinkedIn):** 3 consecutive 429s after retries open the circuit for the rest of the run. Stats record `linkedin.blocked = true`.
- **User-Agent:** `OpenRoles/1.0` for ATS and YC; a normal browser UA for LinkedIn guest pages.

### 3.5 Normalization (`pipeline/normalize.ts`, pure functions)
- `normalizeText(s)`:
  1. Unicode NFKD, strip diacritics
  2. lowercase
  3. `&` → "and"
  4. replace non-alphanumerics with spaces
  5. collapse spaces, trim
- `normalizeCompany(name)`: `normalizeText`, then repeatedly strip **trailing** legal-suffix tokens:
  - general: pvt, private, ltd, limited, inc, incorporated, llc, llp, plc, corp, corporation, co, company, gmbh, bv, sa
  - UAE: fz, fzc, fzco, fze, fz llc, dmcc
  - Stop when nothing changes. Never strip words like "technologies" or "labs".
- `normalizeTitle(t)`: `normalizeText` plus a token map: sr → senior, jr → junior, mgr → manager, eng → engineer, dev → developer, exec → executive.
- `normalizeLocation(l)`: `normalizeText` of the primary location.
- `fingerprint = sha1(normalizeCompany | normalizeTitle | normalizeLocation)`. 40 hex characters; collisions are negligible.

### 3.6 Country and work-mode resolution
`resolveCountry(raw, context)` returns `IN | AE | US | null | OUT`, with this precedence:
1. **Structured codes** (`countryCodes`): map IN/IND/INDIA → IN; AE/ARE/UAE → AE; US/USA → US. Any other code → OUT.
2. **Dictionary match on the location text.** Build a `Map<string, Country>` once at boot:
   - country names and aliases: india; uae, u a e, united arab emirates, emirates; usa, us, u s, united states, america
   - Indian cities with old and new names: bengaluru, bangalore, mumbai, bombay, chennai, madras, gurugram, gurgaon, noida, kolkata, calcutta, …
   - UAE emirates and cities: dubai, abu dhabi, sharjah, ajman, ras al khaimah, fujairah, umm al quwain, al ain
   - US state names and the top ~150 US cities
   - Tokenize each location string; look up 1-, 2- and 3-word n-grams (longest first) in the Map. O(tokens).
3. **US state codes** (`"City, ST"`) count only when nothing else matched. `IN` is Indiana in that pattern but India when a matched Indian city is present. Examples:
   - "Chennai, IN" → IN (city wins)
   - "Indianapolis, IN" → US (city wins)
   - "Remote - IN" → ambiguous: treat as plain remote
4. **Multiple locations:** the job is IN, AE or US if **any** location matches. Country = the first matching target.
5. **Plain remote** ("Remote", "Anywhere", "Worldwide"):
   - LinkedIn: the search's country.
   - Boards: keep with `country = null` only if the same board response has at least one job in a target country.
   - Otherwise drop.
6. **Ambiguous names:** Hyderabad → IN unless "pakistan" appears; Georgia → US only with a US city or state context; Birmingham/Cambridge → need a US state or "usa".

`resolveWorkMode(raw)`:
1. Use `workModeHint` when present.
2. Otherwise text keywords: "remote", "wfh", "work from home" → REMOTE; "hybrid" → HYBRID.
3. Otherwise UNKNOWN. Onsite is set only from structured data.

### 3.7 Job store algorithms (`job-store.service.ts`)
Input: one batch, which is one board response or up to 100 LinkedIn cards.
1. **Pipeline:** parse → normalize → resolve country and work mode → filter:
   - drop rows missing title, company or url
   - drop jobs where `postedAt < now − MAX_JOB_AGE_DAYS`
   - drop jobs whose country is OUT, or null when the board rule doesn't keep them
   - drop blocklisted companies (never block recruitment agencies)
   - missing `postedAt` → now
2. **Batch dedupe:** `Map<fingerprint, job>`, keeping the first. O(n).
3. **Companies:**
   - `names = Set(normalizedName)`
   - `createMany({ skipDuplicates: true })`
   - `findMany({ where: { normalizedName: { in: names } } })` → `Map<normalizedName, id>`
   - Two queries per batch, no N+1. Fill `linkedinUrl` when empty.
4. **Touch:** for **all fetched** jobs (before the age filter, so long-open jobs aren't closed):
   - `updateMany` with `lastSeenAt = now`, `status = ACTIVE`, `closedAt = null`
   - matching `fingerprint IN (...)` OR `(source = S AND externalId IN (...))`
   - in chunks of 1,000
5. **Insert:** `createMany({ data, skipDuplicates: true })` in chunks of 1,000 rows (stays under PostgreSQL's 65,535-parameter limit). The summed counts are the new jobs.
6. **Close (boards only, after a successful read):**
   - set difference: `updateMany` with `status = CLOSED`, `closedAt = now`
   - where `boardId = B AND status = ACTIVE AND externalId NOT IN (current IDs)`
   - **Empty-response guard:** if the board returns 0 jobs but `openJobs > 0`, don't close. Increment `emptyCount`; close everything only on the 2nd consecutive empty response.

### 3.8 Board lane and adaptive polling (`board-lane.service.ts`)
1. **Due boards:**
   - `status = ACTIVE AND nextFetchAt <= now`
   - `ORDER BY nextFetchAt ASC` (oldest first, so nothing starves)
   - `LIMIT MAX_BOARDS_PER_RUN` (default 5,000)
2. **Worker pool:** 5 workers pull from the list (a small internal pool, no dependency). Each board runs in its own try/catch.
3. **Change detection:** `hash = sha1(sorted externalIds)`.
   - Equal to `lastJobsHash`: **unchanged**. Run one query, `UPDATE Job SET lastSeenAt = now WHERE boardId = B AND status = ACTIVE`, and skip the pipeline.
   - Otherwise: run the full store with close.
4. **Adaptive interval:**
   - changed (new or closed jobs) → `fetchIntervalDays = 1`
   - unchanged → `min(interval × 2, 7)`
   - `nextFetchAt = start of IST day (today + interval)`. Day boundaries avoid drift.
5. **Failures:**
   - On failure: `failCount += 1`. At 3 → `BROKEN` (skipped until someone resets it).
   - On success: `failCount = 0`.
   - A failure never closes jobs.

### 3.9 Board finder (`board-finder.service.ts`)
1. **Candidates:**
   - companies where `boardsCheckedAt IS NULL`, or where they have no board and `boardsCheckedAt < now − 30 days`
   - order: `discoveredVia = 'linkedin'` first, then newest
   - `LIMIT MAX_COMPANY_PROBES` (default 100)
2. **Slug guesses** (a Set, at most 4):
   - normalized name joined ("acmepayments")
   - dashed ("acme-payments")
   - original casing joined ("AcmePayments", for SmartRecruiters)
   - website label ("stripe" from stripe.com) when known
3. **Probe:** each slug × the 5 ATS through the HTTP client (3 s timeout, 10 in flight). Stop probing an ATS at its first verified hit.
4. **Verify.** All three must hold:
   - (a) at least one job
   - (b) the API's company name matches the normalized name (Greenhouse `company_name`, SmartRecruiters `company.name`) or the slug equals the normalized name without spaces or dashes
   - (c) at least one job resolves to IN, AE or US
5. **Save:** create Board rows with `nextFetchAt = now`, then set `boardsCheckedAt = now` either way. New boards are read in the same run (the board lane runs a second pass for boards due now).
6. **`scripts/import-yc.ts`:** a one-time import of YC companies where `isHiring = true` (name, website, `discoveredVia = 'yc'`). Optionally also import a one-time export of mono-backend's `AggregatedCompany` (ats + slug) as Board rows.

### 3.10 LinkedIn lane (`linkedin-lane.service.ts`)
Runs only when `LINKEDIN_ENABLED=true`.
1. **Window:** `seconds = clamp(now − lastSuccessfulRun.startedAt + 1h, 24h, 30d)`. The overlap is removed by the unique keys.
2. **Searches:** from `sources.config.ts` as `{ location, country, priority }`.
   - India: Bengaluru, Mumbai, Delhi NCR, Hyderabad, Chennai, Pune, Kolkata, Ahmedabad
   - UAE: Dubai, Abu Dhabi, Sharjah
   - US: the top metros
   - Keywords "" (all roles). No work-type filter, so all types come back.
3. **Budget (fair share):**
   - `perSearch = floor(LINKEDIN_MAX_REQUESTS / searches)` pages
   - a second pass gives leftover requests to searches that hit their share, in priority order
4. **Pagination:**
   - `start += cardsReturned` (10 per page in the test)
   - stop at 0 cards, 1,000 jobs, or the budget/deadline
5. **Run-level seen set:** a `Set<jobId>` across searches skips cards already processed this run (one job often appears in two city searches).
6. **Saving:** cards are flushed to the job store every 100.
7. **Saturation:** a search that reaches 1,000 jobs is added to `stats.linkedin.saturated[]` and Slack mentions it.
   - The fix is to split that search in config by work type (`f_WT=1|2|3`) or experience (`f_E`). Verify those parameters against a live response first.
   - v2: automatic recursive facet splitting (divide and conquer).
8. **Blocking:** the circuit breaker (3.4) stops the lane. The run becomes PARTIAL.

### 3.11 Run orchestrator (`run-orchestrator.service.ts`)
1. **Lease:**
   - In one transaction, mark RUNNING runs with `heartbeatAt < now − 10 min` as FAILED ("stale lease").
   - Then insert a RUNNING FetchRun.
   - A unique violation on `fetch_run_single_running` means another run is active: log and exit 0.
2. **Heartbeat:** `setInterval` updates `heartbeatAt` every 60 s.
3. **Deadline:** `startedAt + RUN_DEADLINE_MINUTES` (90). Lanes check it between items and stop cleanly (status PARTIAL, reason "deadline").
4. **Lanes:**
   - `Promise.allSettled([linkedinLane(), boardLane()])` (different hosts, so in parallel)
   - then `boardFinder()`
   - then `boardLane({ onlyNew: true })`
5. **Retention.**
6. **Finish:**
   - Write `stats`, status and `finishedAt`; clear the heartbeat.
   - Status: SUCCESS when nothing failed; PARTIAL when any feed failed, LinkedIn was blocked or the deadline was hit; FAILED when every lane failed or an unhandled error happened.
   - Send the Slack summary.

`stats` JSON shape:
```json
{
  "durationMs": 0,
  "window": { "since": "ISO", "seconds": 0 },
  "linkedin": { "enabled": true, "requests": 0, "cards": 0, "new": 0, "saturated": [], "blocked": false },
  "boards": { "due": 0, "read": 0, "unchanged": 0, "failed": 0, "broken": 0, "new": 0, "closed": 0, "errors": [] },
  "finder": { "probedCompanies": 0, "boardsFound": 0 },
  "retention": { "deletedJobs": 0 },
  "totals": { "newJobs": 0, "newCompanies": 0 }
}
```

### 3.12 Retention (`retention.service.ts`)
- Repeat `DELETE FROM "Job" WHERE id IN (SELECT id FROM "Job" WHERE "lastSeenAt" < $cutoff LIMIT 5000)` until 0 rows are affected. Short statements mean no long locks.
- FetchRun rows older than 180 days are deleted the same way.

### 3.13 API (`jobs/`)
- **Global:**
  - `/api` prefix
  - `helmet`
  - CORS only for `FRONTEND_ORIGIN`
  - `ValidationPipe({ whitelist: true, transform: true })`
  - `ApiKeyGuard` on everything except `GET /api/health` (`crypto.timingSafeEqual` on the `x-api-key` header)
- **Endpoints:**
  | Endpoint | Query | Notes |
  |---|---|---|
  | `GET /api/jobs` | `view=new\|week\|all`, `country=IN\|AE\|US`, `workMode=ONSITE\|HYBRID\|REMOTE`, `source`, `q` (≥ 2 chars), `page`, `pageSize` (≤ 100) | new: `firstSeenAt >= startOfTodayIST`. week: `>= startOfTodayIST − 6 days`. all: `postedAt >= now − 30 d`. Always `status = ACTIVE`. Sort `firstSeenAt DESC, id DESC` (all: `postedAt DESC`). Returns `{ items, total, page, pageSize }`. |
  | `GET /api/companies` | same filters | Raw parameterized SQL: `GROUP BY company` with `count(*)`, `count(*) FILTER (WHERE firstSeenAt >= today)`, `max(postedAt)`, `array_agg(DISTINCT source)`. Sort newToday DESC, openRoles DESC. |
  | `GET /api/companies/:id/jobs` | | Active jobs at one company |
  | `GET /api/runs/latest` | | Last finished run plus `isRunning` |
  | `GET /api/health` | | `{ ok: true, db: true }` |
- **Search:** `title ILIKE %q% OR company.name ILIKE %q%`, served by the pg_trgm GIN indexes.
- **Caching:** `Cache-Control: private, max-age=60`. The frontend `fetch` uses `next: { revalidate: 300 }`.

### 3.14 Configuration (`backend/.env`, validated at boot; commit `.env.example` only)
| Var | Default | Purpose |
|---|---|---|
| DATABASE_URL | (required) | PostgreSQL |
| PORT | 4000 | API port |
| API_KEY | (required) | Shared secret with the frontend |
| FRONTEND_ORIGIN | http://localhost:3000 | CORS |
| TARGET_COUNTRIES | IN,AE,US | Markets (a setting, so adding one is a config change) |
| MAX_JOB_AGE_DAYS | 30 | "No old jobs" |
| RETENTION_DAYS | 90 | Delete jobs unseen this long |
| RUN_DEADLINE_MINUTES | 90 | Stop cleanly after this |
| MAX_BOARDS_PER_RUN | 5000 | Board lane cap |
| MAX_COMPANY_PROBES | 100 | Board finder cap |
| LINKEDIN_ENABLED | false | Switch; on only after the lead's OK |
| LINKEDIN_MAX_REQUESTS | 300 | LinkedIn budget per run |
| SLACK_WEBHOOK_URL | (empty) | Optional summary and alerts |

No job source needs an API key.

### 3.15 Errors and logging
- **Typed errors:** `NotFoundError`, `RateLimitedError`, `SchemaChangedError`, `TimeoutError`, `BlockedError`. Board errors are stored in `stats.boards.errors` (capped at 50) as `{ ats, slug, code }`.
- **Logging:** Nest `Logger`. One line per lane at the end and one summary line per run. No per-job logs in production.

---

## 4. Low-level design: frontend (`frontend/`)
- **Framework:** Next.js App Router with React Server Components, TypeScript strict, Tailwind and shadcn/ui.
- **Routes:**
  - `/`: the sales page
  - `/companies/[id]`: all roles at one company
  - plus `loading.tsx`, `error.tsx`, and `not-found.tsx`
- **URL state:**
  - `view=new|week|all`
  - `mode=jobs|companies`
  - `country`, `source`, `workMode`, `q`, `page`
  - Shareable links. The server components read `searchParams`.
- **Data:** `lib/api.ts` (`import 'server-only'`) calls `API_URL` with `x-api-key: API_KEY` and `next: { revalidate: 300 }`. Response types are in `lib/types.ts` and mirror the API DTOs.
- **Components:**
  - `RunStatusBanner`: "Updated today 06:14 IST · N new roles at M companies"
  - `ViewTabs`, `Filters` (client; search debounced 300 ms → `router.replace`), `ModeToggle`
  - `JobsTable`, `CompaniesTable`, `Pagination`
  - `SourceBadge`, `WorkModeBadge`, `EmptyState`
- **Formatting:** times are shown in IST with `Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata' })`. Relative times use `Intl.RelativeTimeFormat`.
- **Links:** "Open job" opens in a new tab with `rel="noopener noreferrer"`.
- **Auth:** pending decision. Recommended: Auth.js with Google sign-in limited to the company domain, via `middleware.ts`.

---

## 5. Cron and deployment
- **Local:**
  - The developer's own PostgreSQL 16 (the one pgAdmin connects to); no Docker needed
  - `npm run jobs:fetch:dev -- --source=lever` runs one source
- **Backend image:** a multi-stage Dockerfile. The same image runs the API (`node dist/main.js`) and the script (`node dist/scripts/fetch-jobs.js`). `prisma migrate deploy` runs on release.
- **Cron:** `@Cron('0 0 6 * * *', { timeZone: 'Asia/Kolkata' })` inside the API (see "As built: daily schedule"). Hosting is AWS: run the API as an always-on service (ECS or EC2), never a serverless function. With several API servers, set `DISABLE_CRONS=true` on all but one; the lease makes it safe either way.
- **Frontend:** Vercel or the same host.
- **CI (GitHub Actions):** install → lint → typecheck → test (Postgres service) → build, for both apps.

## 6. Observability and alerts
- **FetchRun row:** written every run; it powers the banner and the run history.
- **Slack summary:** "25 Nov · SUCCESS in 41 min · 312 new roles at 128 companies · boards 2,140 due / 2,121 read / 19 failed · LinkedIn 300 requests, 2,410 cards, not blocked · 37 new boards".
- **Alerts:**
  - status FAILED
  - LinkedIn blocked
  - `SchemaChangedError` on any ATS
  - new jobs below 20% of the 7-run moving average (catches silent breakage)
  - no successful run in 26 h (external uptime check on `/api/runs/latest`)

## 7. Security
- **API key** between frontend and backend, compared timing-safe, server-side only. Never prefixed `NEXT_PUBLIC_`.
- **Sales login** before go-live (decision pending).
- **Hardening:** helmet, strict CORS, validated query params, parameterized raw SQL only.
- **Data:** no personal data stored (no recruiter names or emails). Secrets only in env; `.env` is git-ignored.

## 8. Testing
- **Unit:** table-driven tests for:
  - `normalizeCompany` ("Acme Payments Pvt. Ltd." = "Acme Payments Private Limited"; "Acme FZ-LLC" = "Acme")
  - `normalizeTitle`, fingerprint stability
  - `resolveCountry` ("Indianapolis, IN" → US; "Chennai, IN" → IN; "Bengaluru-VTP, India" → IN; "New York, NY (HQ)" → US; "Dubai - UAE" → AE; "Remote" → board rule; "Paris" → OUT; "Hyderabad" → IN)
  - `resolveWorkMode`, the backoff calculation, the adaptive interval, slug guesses, fair-share budget
- **Parsers:** one test per source against `test/fixtures/*`.
- **Integration** (real Postgres):
  - job store: duplicates skipped, touch, set-difference close, empty-response guard
  - lease: a second run exits
  - retention batches
- **API e2e** (supertest): auth, filters, pagination, views.
- **Acceptance:** run `jobs:fetch` twice; the second run inserts 0 jobs.

## 9. Build phases (stop for review after each)
1. **Repo + backend skeleton:** Nest, config validation, Prisma schema, migrations (including the extra SQL).
2. **Pipeline helpers:** `normalize.ts`, `country.ts`, `work-mode.ts`, `filter.ts`, with unit tests.
3. **HTTP client and readers:** limiter, retry, breaker, plus the five board readers with zod schemas and fixture tests.
4. **Job store:** batch dedupe, company upsert, touch, insert, close, guards, with integration tests.
5. **Board lane:** adaptive polling, change detection, worker pool.
6. **Board finder** + `import-yc`.
7. **Orchestrator + script:** lease, heartbeat, deadline, retention, reporter, Slack. Acceptance: second run = 0 new.
8. **API:** guard, DTOs, endpoints, e2e tests.
9. **Frontend:** page, filters, tables, banner, company page.
10. **LinkedIn lane** behind `LINKEDIN_ENABLED`, only after the lead's OK.
11. **Deploy:** Dockerfile, cron, CI, README.

**Definition of done (v1):**
- `npm run jobs:fetch` runs end to end and exits.
- A second run inserts 0 jobs.
- No saved job is older than 30 days or outside IN, AE and US (except board-ruled plain remote).
- The sales page works with filters and links.
- Tests and lint pass in both apps.

## 10. Open decisions
- ~~The lead's OK for LinkedIn~~: approved 25 Nov 2026. Apify's LinkedIn scraper (about $1 per 1,000 jobs) is under discussion for more volume.
- ~~The hosting target~~: AWS (25 Nov 2026). The API runs the daily cron.
- How salespeople log in.
