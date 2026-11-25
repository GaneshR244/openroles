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
