---
name: openroles-build
description: Build or change a phase of OpenRoles (daily job-post collector + sales page) following the approved architecture. Use when the user asks to build, code, start, continue or fix OpenRoles, or names a phase number.
---

# Building OpenRoles

## Before writing code
1. Read `REQUIREMENTS.md`, `CLAUDE.md` and `docs/ARCHITECTURE.md`. Read the whole architecture doc the first time in a session.
2. Work out which phase is requested (architecture §9). If none was named, find the first unfinished phase by checking what exists in `backend/` and `frontend/`, and confirm it with the user in one line.
3. List the files you'll create or change and the tests you'll add. Keep to that phase's scope only.

## While building
- Match the module layout in §3.1 and §4 exactly. Use the Prisma schema in §3.2 as written, plus the extra SQL migration.
- Readers: before writing a parser, fetch one real response with curl, save it to `backend/test/fixtures/{source}.json`, and confirm field names against it. The verified mappings are in §3.3; note in the fixture test any field that differs.
- Algorithms must follow the doc:
  - batch dedupe with a Map
  - batched company upsert
  - touch before filtering
  - `createMany` with `skipDuplicates` in chunks of 1,000
  - set-difference close with the empty-response guard
  - adaptive polling
  - lease with a partial unique index plus heartbeat
  - fair-share LinkedIn budget
  - full-jitter backoff
  - circuit breaker
- No new dependencies beyond these without asking:
  - backend: `@nestjs/*` (incl. `@nestjs/config`), `prisma`/`@prisma/client`/`@prisma/adapter-pg`, `zod` (also used for request validation through Nest's `StandardSchemaValidationPipe`), `cheerio`, `helmet`
  - frontend: `next`, `react`, `tailwindcss`, shadcn/ui and its peers
  - tests and lint: `vitest`, `supertest`, `oxlint`, `eslint`
- Backend is ESM: relative imports end in `.js`. Install with `npx npm@11 install`.
- Log every finished phase in `docs/PROGRESS.md`: what was built, the check results, and any difference from the doc.
- Keep functions small and pure where the doc says pure (`pipeline/*`).

## Before saying a phase is done
1. Run lint, typecheck and tests for the app you touched, and show the result.
2. For phases 7 and later: run `npm run jobs:fetch:dev` against the local database, show the FetchRun row, run it again, and show 0 new jobs on the second run.
3. Summarize what was built, anything that differs from the doc (and the doc update), and what the next phase is. Then stop and wait for the user's OK.

## Never
- Store job descriptions, salary, skills or experience.
- Use LinkedIn cookies, accounts, proxies or anything that bypasses blocks.
- Run the morning job inside a serverless function.
- Mark jobs closed after a failed or suspicious empty board read.
