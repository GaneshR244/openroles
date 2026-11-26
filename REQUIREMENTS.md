# OpenRoles: Requirement

Plain-language summary of what we are building and why. No technical detail.
Last updated: 25 Nov 2026. Status: planning only, nothing built yet.

## Why we need it

- Hyring sells AI hiring tools: resume screening, phone screening, and one-way and two-way video interviews.
- When a company posts a job, it needs candidates now. That's the best time for our sales team to talk to them.
- Sales needs a daily list of **which companies are hiring, for which role, with a link to the live job post**.

## What we build

1. **A script that runs by itself every morning** (a cron job). It collects new public job posts from the internet.
2. **It saves them in our database.** For each job, it saves:
   - company name
   - job title
   - location
   - link to the live job post
   - date posted
   - which site it came from
3. **Later, a page in our internal sales CRM** shows this list to sales. The UI will be planned later.

We do **not** collect job descriptions, years of experience, salary or skills. Sales clicks the link to see those.

## Rules

- **No duplicates.** If a job was saved today, it is not saved again tomorrow. Sales sees each job as "new" only once.
  - Example: today 10 jobs, tomorrow 15 (the same 10 plus 5 new). Only the 5 new ones are added.
- **No old jobs.** Only jobs posted in about the last 30 days.
- **Runs every morning**, around 6:00 AM IST, so the list is fresh when sales starts work.
- **Only correct data.** If a site can't be fetched reliably, we leave it out.
- **Simple, clean, well-structured code.** Not complicated.
- **A new, separate project.** Not inside `mono-backend`.
- **Tech:**
  - Backend: NestJS + Prisma + PostgreSQL.
  - Frontend: Next.js + Tailwind + shadcn/ui.
- **No API keys needed** for any job source. They're all public.
- Technical design: https://claude.ai/artifact/QUqYRP2myQixsoZP8uFsSi

## Where the jobs come from

- **LinkedIn**, through **Apify** (approved by the lead on 26 Nov 2026). Apify's `curious_coder/linkedin-jobs-scraper` does the scraping on Apify's servers, and we read the results through its API. We use the free plan: 50 jobs a day, about $3 of the $5 monthly free credit. Our own logged-out reader is still there as a fallback (`LINKEDIN_PROVIDER=guest`).
- **Public company job boards.** Tested and working:
  - Greenhouse
  - Lever
  - Ashby
  - SmartRecruiters
  - Workable
- **Common Crawl** (a free public web archive), to find every company that has a Greenhouse, Lever, Ashby or SmartRecruiters job board. Refreshed once a month. Added 26 Nov 2026.
- **The YC company list**, to find companies that are hiring.
- **Maybe later:**
  - Recruitee, Personio and Teamtailor (they work, but mostly cover European companies)
  - Adzuna (needs a free key)
- **Not used:** sites that failed our test (Workday, BambooHR, Breezy, Jobvite, the VC job boards) and sites with no public access (Indeed, Naukri, Glassdoor).

## Who we target

- **Every country** (changed 26 Nov 2026; it was India, the UAE and the US). Sales can filter by country on the page.
- **All kinds of roles**, and **all work types**: onsite, hybrid and remote.
  - With every country on, remote jobs are all kept; a job whose location names no country shows without one.
  - If `TARGET_COUNTRIES` is narrowed, a remote job counts when it names one of those countries ("Remote - India"), and a plain "Remote" job counts when the same company also has jobs there.
- **The countries are a setting:** `TARGET_COUNTRIES=ALL` (the default) keeps every country; a list such as `IN,AE,US` narrows it, with no code change.
- **All sizes of company:** startups, mid-size and big.
- **Recruitment agencies stay in the list.** They are Hyring customers too.
- **No target company list from sales.** We find the companies ourselves.

## Project docs

- `docs/ARCHITECTURE.md`: full HLD + LLD. The source of truth for code.
- `CLAUDE.md`: rules for building this project.
- `.claude/skills/openroles-build/SKILL.md`: step-by-step procedure for building each phase.

## Related work

- Our recent project in `mono-backend` (the job-aggregation module) already collects jobs for the candidate job board. We reuse its ideas (sources, how it finds each company's job board) but skip its heavy parts (reading descriptions with AI, queues).
- Full plan page: https://claude.ai/artifact/FsS8qGJKjpB46chjEou7gP

## Answers from the team (25 Nov 2026)

| Question | Answer |
|---|---|
| Which countries? | India, UAE and US |
| Morning run time | The team works in India and starts at 8:00 AM IST, so a 6:00 AM IST run is fine |
| Which roles? | All roles |
| Which companies? | All sizes: startups, mid-size, big |
| Recruitment agencies? | Include them |
| Sales CRM page | A separate internal tool. The company also uses Close CRM, but this page isn't Close. |
| Target company list? | None. We find companies ourselves. |
| "Levels dot something" | Lever |
| Inside mono-backend? | No, a new separate project |

## Still open

- ~~Where will the backend be hosted?~~ **AWS** (25 Nov 2026). The backend server runs the 6 AM job itself, the same way our other backend runs its scheduled jobs.
- **Sales login:** not wanted for now (25 Nov 2026). The page only shows data.
- ~~LinkedIn~~: **approved on 25 Nov 2026.** It reads the public job search while logged out, slowly, and stops when blocked.
