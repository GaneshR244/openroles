# OpenRoles

OpenRoles is an internal tool that shows Hyring's sales team which companies are hiring, for which role, with a link to the live job post. It covers every country by default (`TARGET_COUNTRIES` can narrow it), all roles, all company sizes and all work types. Recruitment agencies are included because they are customers.

- What and why, in plain language: `REQUIREMENTS.md`
- How (HLD + LLD), the source of truth for code: `docs/ARCHITECTURE.md`
- To build a phase, use the `openroles-build` skill (`.claude/skills/openroles-build/SKILL.md`).

## Stack
- `backend/`: NestJS 12, Prisma 7, PostgreSQL. A read-only API that also runs the daily fetch at 06:00 IST (`@nestjs/schedule`, `src/schedule/`). The same fetch can be run by hand: `npm run jobs:fetch`.
- `frontend/`: Next.js 16 (App Router), Tailwind CSS 4, shadcn/ui.
- Two folders in one repo, each with its own package.json. No monorepo tooling.
- Progress log: `docs/PROGRESS.md`. Add a short entry for every phase.

## How the backend is set up
- **ESM only** (NestJS 12): relative imports end in `.js`; use `import.meta.dirname`, never `__dirname`.
- **Tests:** Vitest. Unit tests sit beside the code as `src/**/*.spec.ts`. Integration and e2e tests are `test/**/*.int-spec.ts` and `test/**/*.e2e-spec.ts`; they use the `openroles_test` database through `DATABASE_URL_TEST`.
  - Commands: `npm test`, `npm run test:e2e`, `npm run lint` (oxlint), `npm run typecheck`.
- **Prisma 7:**
  - `prisma.config.ts` holds the config.
  - The client is generated into `src/generated/prisma`; import from `../generated/prisma/client.js`.
  - `PrismaService` uses `@prisma/adapter-pg`.
  - New migrations: `npx prisma migrate dev --create-only --name x`, edit, then `npx prisma migrate deploy` (`migrate dev` can wait on a prompt).
- **Request validation:** zod schemas with Nest's `StandardSchemaValidationPipe`. No class-validator.
- **Installs:** use npm 11 (`npx npm@11 install …`). npm 10.9 crashes resolving Vitest's peers.
- **Script runs:** `npm run jobs:fetch:dev` builds, then runs `dist/scripts/fetch-jobs.js`.
- **Frontend checks:** `npm run typecheck` (runs `next typegen` first), `npm run lint`, `npm run build`.

## Rules
- Simple, readable, well-structured code. Small files, clear names, no clever abstractions.
- Follow `docs/ARCHITECTURE.md`. If code needs to differ, update the doc in the same change and say why.
- **Store per job only:** company, title, location, country (ISO 3166-1 alpha-2 code, or null), work mode, URL, posted date, source, external ID. Never descriptions, salary, skills or experience.
- **Dedupe is enforced by the database:** unique `(source, externalId)` and unique `fingerprint`, with `createMany({ skipDuplicates: true })`. Never rely on in-memory state for correctness.
- **Every run must be safe to repeat.**
- **One failing board or source must never stop the run.**
- **Correctness over coverage:** if a source can't be read reliably, skip it and report it.
- **All outbound HTTP goes through `common/http/http-client.ts`** (per-host limits, retry, circuit breaker). Never call `fetch` directly from a reader.
- **Validate every external response with its zod schema.** Parser tests use saved real responses in `backend/test/fixtures/`.
- **Finding boards:** the monthly Common Crawl import (`ingestion/board-import.service.ts`) finds Greenhouse, Lever, Ashby and SmartRecruiters boards; the board finder guesses boards for companies we already know. Never probe Workable in bulk (it rate-limits for a day).
- **LinkedIn:** logged-out guest search only, behind `LINKEDIN_ENABLED`. Never cookies, accounts, proxies or block bypassing.
- **Daily fetch:** one `@Cron` in `src/schedule/daily-fetch.scheduler.ts` (06:00 IST) calls `RunOrchestratorService`. Keep run logic in the orchestrator so the cron and the manual script share it. `DISABLE_CRONS=true` switches the cron off on a server, and the FetchRun lease stops double runs across servers.
- **Dependencies:** no Puppeteer/Playwright, Redis, queues, telemetry SDKs or agent-skill bundles. Ask before adding any dependency not listed in the architecture doc.
- **Time:** store UTC; compute "today" in Asia/Kolkata.
- **Secrets:** only in `.env` (git-ignored); commit `.env.example`. The frontend's `API_KEY` is server-side only, never `NEXT_PUBLIC_`.
- **Build one phase at a time** (architecture §9) and stop for review after each.
