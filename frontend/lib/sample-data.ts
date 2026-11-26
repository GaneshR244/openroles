// DEV-ONLY made-up data, used when OPENROLES_SAMPLE_DATA=1 (see lib/api.ts and .env.example).
// Every company is fictional. Links use the reserved ".example" domain, so they never reach a real site.
// Filters, sorting and pagination copy the API rules in docs/ARCHITECTURE.md §3.13.
import { SOURCES } from "./filters";
import { startOfDayIST } from "./format";
import type {
  CompanyItem,
  CountryCount,
  Country,
  JobFilters,
  JobItem,
  JobSource,
  Paged,
  RunSummary,
  WorkMode,
} from "./types";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RUN_START = 6 * HOUR; // 06:00 IST
const RUN_LENGTH = 14 * MINUTE; // so the banner reads "06:14 IST"

type SampleCompany = { id: string; slug: string; name: string; linkedin: boolean };

const COMPANIES: SampleCompany[] = [
  { id: "smp-kaveri", slug: "kaveri-fintech", name: "Kaveri Fintech", linkedin: true },
  { id: "smp-saffronleaf", slug: "saffronleaf-health", name: "Saffronleaf Health", linkedin: true },
  { id: "smp-tejaswi", slug: "tejaswi-logistics", name: "Tejaswi Logistics", linkedin: false },
  { id: "smp-nilgiri", slug: "nilgiri-cloudworks", name: "Nilgiri Cloudworks", linkedin: true },
  { id: "smp-monsoonbyte", slug: "monsoonbyte-labs", name: "Monsoonbyte Labs", linkedin: false },
  // A recruitment agency: hires for clients in all three markets.
  { id: "smp-bridgewell", slug: "bridgewell-talent", name: "Bridgewell Talent Partners", linkedin: true },
  { id: "smp-falconridge", slug: "falconridge-ledger", name: "Falconridge Ledger", linkedin: true },
  { id: "smp-dunewave", slug: "dunewave-mobility", name: "Dunewave Mobility", linkedin: false },
  { id: "smp-pearlbay", slug: "pearlbay-retail", name: "Pearlbay Retail", linkedin: true },
  { id: "smp-harborline", slug: "harborline-analytics", name: "Harborline Analytics", linkedin: true },
  { id: "smp-quillfeather", slug: "quillfeather-robotics", name: "Quillfeather Robotics", linkedin: false },
  { id: "smp-prairiegate", slug: "prairiegate-health", name: "Prairiegate Health", linkedin: true },
  { id: "smp-beaconfield", slug: "beaconfield-security", name: "Beaconfield Security", linkedin: true },
  { id: "smp-copperleaf", slug: "copperleaf-commerce", name: "Copperleaf Commerce", linkedin: false },
];

type SampleJob = {
  company: string; // SampleCompany.id
  title: string;
  location: string | null;
  country: Country | null;
  workMode: WorkMode;
  source: JobSource;
  seenDaysAgo: number; // 0 = found by today's run
  postedHoursEarlier: number; // how long before it was found the post went up
};

const JOBS: SampleJob[] = [
  // Found by today's run
  { company: "smp-kaveri", title: "Senior Backend Engineer (Java)", location: "Bengaluru, Karnataka, India", country: "IN", workMode: "HYBRID", source: "GREENHOUSE", seenDaysAgo: 0, postedHoursEarlier: 20 },
  { company: "smp-kaveri", title: "Product Manager, Payments", location: "Bengaluru, India", country: "IN", workMode: "ONSITE", source: "LINKEDIN", seenDaysAgo: 0, postedHoursEarlier: 3 },
  { company: "smp-saffronleaf", title: "Clinical Data Analyst", location: "Mumbai, Maharashtra", country: "IN", workMode: "HYBRID", source: "LEVER", seenDaysAgo: 0, postedHoursEarlier: 30 },
  { company: "smp-bridgewell", title: "Recruitment Consultant, Tech Hiring", location: "Gurugram, Haryana, India", country: "IN", workMode: "ONSITE", source: "LINKEDIN", seenDaysAgo: 0, postedHoursEarlier: 5 },
  { company: "smp-bridgewell", title: "Senior Talent Acquisition Partner", location: "Dubai, United Arab Emirates", country: "AE", workMode: "ONSITE", source: "LINKEDIN", seenDaysAgo: 0, postedHoursEarlier: 8 },
  { company: "smp-falconridge", title: "Compliance Officer (AML)", location: "Dubai, UAE", country: "AE", workMode: "ONSITE", source: "GREENHOUSE", seenDaysAgo: 0, postedHoursEarlier: 12 },
  { company: "smp-dunewave", title: "Fleet Operations Manager", location: "Abu Dhabi, United Arab Emirates", country: "AE", workMode: "ONSITE", source: "WORKABLE", seenDaysAgo: 0, postedHoursEarlier: 26 },
  { company: "smp-harborline", title: "Data Engineer", location: "New York, NY", country: "US", workMode: "HYBRID", source: "ASHBY", seenDaysAgo: 0, postedHoursEarlier: 15 },
  { company: "smp-beaconfield", title: "Security Engineer, Detection & Response", location: "Remote, US", country: "US", workMode: "REMOTE", source: "ASHBY", seenDaysAgo: 0, postedHoursEarlier: 9 },
  { company: "smp-quillfeather", title: "Robotics Software Engineer", location: "Pittsburgh, PA", country: "US", workMode: "ONSITE", source: "LEVER", seenDaysAgo: 0, postedHoursEarlier: 40 },
  { company: "smp-nilgiri", title: "Site Reliability Engineer", location: "Remote", country: null, workMode: "REMOTE", source: "ASHBY", seenDaysAgo: 0, postedHoursEarlier: 18 },
  // Earlier this week
  { company: "smp-tejaswi", title: "Warehouse Operations Lead", location: "Pune, Maharashtra, India", country: "IN", workMode: "ONSITE", source: "SMARTRECRUITERS", seenDaysAgo: 1, postedHoursEarlier: 24 },
  { company: "smp-monsoonbyte", title: "Frontend Engineer (React)", location: "Chennai, Tamil Nadu", country: "IN", workMode: "REMOTE", source: "WORKABLE", seenDaysAgo: 1, postedHoursEarlier: 10 },
  { company: "smp-nilgiri", title: "Solutions Architect", location: "Hyderabad, Telangana, India", country: "IN", workMode: "HYBRID", source: "ASHBY", seenDaysAgo: 2, postedHoursEarlier: 30 },
  { company: "smp-saffronleaf", title: "Medical Sales Representative", location: "New Delhi, India", country: "IN", workMode: "ONSITE", source: "LINKEDIN", seenDaysAgo: 2, postedHoursEarlier: 6 },
  { company: "smp-dunewave", title: "Mobile Developer (Flutter)", location: "Dubai, UAE", country: "AE", workMode: "REMOTE", source: "WORKABLE", seenDaysAgo: 2, postedHoursEarlier: 20 },
  { company: "smp-pearlbay", title: "Store Manager, Dubai Mall", location: "Dubai", country: "AE", workMode: "ONSITE", source: "SMARTRECRUITERS", seenDaysAgo: 3, postedHoursEarlier: 48 },
  { company: "smp-pearlbay", title: "E-commerce Marketing Executive", location: "Dubai, United Arab Emirates", country: "AE", workMode: "HYBRID", source: "LINKEDIN", seenDaysAgo: 3, postedHoursEarlier: 4 },
  { company: "smp-prairiegate", title: "Registered Nurse, Telehealth", location: "Austin, TX", country: "US", workMode: "REMOTE", source: "GREENHOUSE", seenDaysAgo: 4, postedHoursEarlier: 20 },
  { company: "smp-copperleaf", title: "Account Executive, Mid-Market", location: "Seattle, WA", country: "US", workMode: "HYBRID", source: "LEVER", seenDaysAgo: 4, postedHoursEarlier: 36 },
  { company: "smp-harborline", title: "Analytics Engineer", location: "New York, NY", country: "US", workMode: "UNKNOWN", source: "ASHBY", seenDaysAgo: 5, postedHoursEarlier: 12 },
  { company: "smp-kaveri", title: "Customer Success Associate", location: "Bengaluru, India", country: "IN", workMode: "UNKNOWN", source: "GREENHOUSE", seenDaysAgo: 5, postedHoursEarlier: 72 },
  { company: "smp-bridgewell", title: "Executive Search Associate", location: "New York, NY, United States", country: "US", workMode: "HYBRID", source: "LINKEDIN", seenDaysAgo: 6, postedHoursEarlier: 10 },
  { company: "smp-falconridge", title: "Senior Accountant", location: "Abu Dhabi", country: "AE", workMode: "HYBRID", source: "GREENHOUSE", seenDaysAgo: 6, postedHoursEarlier: 30 },
  // Older, still open
  { company: "smp-quillfeather", title: "Mechanical Design Engineer", location: "Pittsburgh, PA", country: "US", workMode: "ONSITE", source: "LEVER", seenDaysAgo: 8, postedHoursEarlier: 48 },
  { company: "smp-beaconfield", title: "Customer Support Specialist", location: "Remote, US", country: "US", workMode: "REMOTE", source: "ASHBY", seenDaysAgo: 9, postedHoursEarlier: 24 },
  { company: "smp-copperleaf", title: "Senior Product Designer", location: "Seattle, WA", country: "US", workMode: "REMOTE", source: "LINKEDIN", seenDaysAgo: 10, postedHoursEarlier: 2 },
  { company: "smp-tejaswi", title: "Supply Chain Analyst", location: "Pune, India", country: "IN", workMode: "HYBRID", source: "SMARTRECRUITERS", seenDaysAgo: 11, postedHoursEarlier: 30 },
  { company: "smp-monsoonbyte", title: "QA Engineer", location: "Chennai, India", country: "IN", workMode: "ONSITE", source: "WORKABLE", seenDaysAgo: 12, postedHoursEarlier: 20 },
  { company: "smp-prairiegate", title: "Medical Billing Specialist", location: "Dallas, TX", country: "US", workMode: "ONSITE", source: "GREENHOUSE", seenDaysAgo: 14, postedHoursEarlier: 50 },
  { company: "smp-nilgiri", title: "Technical Writer", location: "Remote, India", country: "IN", workMode: "REMOTE", source: "ASHBY", seenDaysAgo: 15, postedHoursEarlier: 10 },
  { company: "smp-saffronleaf", title: "Pharmacovigilance Associate", location: "Mumbai, India", country: "IN", workMode: "ONSITE", source: "LEVER", seenDaysAgo: 17, postedHoursEarlier: 40 },
  { company: "smp-pearlbay", title: "Visual Merchandiser", location: "Sharjah, United Arab Emirates", country: "AE", workMode: "ONSITE", source: "SMARTRECRUITERS", seenDaysAgo: 19, postedHoursEarlier: 24 },
  { company: "smp-harborline", title: "Sales Development Representative", location: "Chicago, IL", country: "US", workMode: "HYBRID", source: "LINKEDIN", seenDaysAgo: 21, postedHoursEarlier: 5 },
  { company: "smp-falconridge", title: "Risk Analyst", location: "Dubai, UAE", country: "AE", workMode: "HYBRID", source: "GREENHOUSE", seenDaysAgo: 24, postedHoursEarlier: 30 },
  { company: "smp-kaveri", title: "DevOps Engineer", location: "Bengaluru, India", country: "IN", workMode: "HYBRID", source: "GREENHOUSE", seenDaysAgo: 27, postedHoursEarlier: 20 },
];

export function sampleJobs(filters: JobFilters, now: number): Paged<JobItem> {
  return paginate(filterJobs(allJobs(now), filters, now), filters);
}

export function sampleCompanies(filters: JobFilters, now: number): Paged<CompanyItem> {
  const jobs = filterJobs(allJobs(now), filters, now);
  const today = startOfDayIST(now);
  const companies = COMPANIES.map((company) =>
    companyItem(company, jobs.filter((job) => job.company.id === company.id), today),
  )
    .filter((company) => company.openRoles > 0)
    .sort(
      (a, b) =>
        b.newToday - a.newToday || b.openRoles - a.openRoles || a.name.localeCompare(b.name),
    );
  return paginate(companies, filters);
}

export function sampleCompanyJobs(
  id: string,
  now: number,
): { company: CompanyItem; jobs: JobItem[] } | null {
  const company = COMPANIES.find((c) => c.id === id);
  if (!company) return null;
  const jobs = allJobs(now)
    .filter((job) => job.company.id === id)
    .sort(byNewestFirstSeen);
  return { company: companyItem(company, jobs, startOfDayIST(now)), jobs };
}

export function sampleCountries(now: number): CountryCount[] {
  const counts = new Map<string, number>();
  for (const job of filterJobs(allJobs(now), { view: "all", page: 1, pageSize: 1 }, now)) {
    if (job.country) counts.set(job.country, (counts.get(job.country) ?? 0) + 1);
  }
  return [...counts]
    .map(([code, jobs]) => ({ code, jobs }))
    .sort((a, b) => b.jobs - a.jobs);
}

export function sampleRunSummary(now: number): RunSummary {
  const run = latestRun(now);
  const today = startOfDayIST(now);
  const newJobs = allJobs(now).filter((job) => Date.parse(job.firstSeenAt) >= today);
  return {
    lastRun: {
      id: "smp-run-latest",
      status: "SUCCESS",
      startedAt: new Date(run.startedAt).toISOString(),
      finishedAt: new Date(run.finishedAt).toISOString(),
      newJobs: newJobs.length,
      newCompanies: 2,
    },
    isRunning: false,
    today: {
      newJobs: newJobs.length,
      companies: new Set(newJobs.map((job) => job.company.id)).size,
    },
  };
}

/** Today's 06:00–06:14 IST run; before 06:14 IST it pretends the run just finished. */
function latestRun(now: number): { startedAt: number; finishedAt: number } {
  const today = startOfDayIST(now);
  let finishedAt = today + RUN_START + RUN_LENGTH;
  if (finishedAt > now) finishedAt = Math.max(today + MINUTE, now - MINUTE);
  return { startedAt: finishedAt - RUN_LENGTH, finishedAt };
}

function allJobs(now: number): JobItem[] {
  const today = startOfDayIST(now);
  const run = latestRun(now);
  return JOBS.map((job, index) => {
    const firstSeen =
      job.seenDaysAgo === 0
        ? Math.max(today, run.finishedAt - (index + 1) * 50 * 1000)
        : today - job.seenDaysAgo * DAY + RUN_START + index * 30 * 1000;
    const company = COMPANIES.find((c) => c.id === job.company)!;
    const externalId = String(4_100_000 + index * 137);
    return {
      id: `smp-job-${String(index + 1).padStart(2, "0")}`,
      title: job.title,
      company: { id: company.id, name: company.name },
      location: job.location,
      country: job.country,
      workMode: job.workMode,
      url: jobUrl(job.source, company.slug, externalId),
      source: job.source,
      postedAt: new Date(firstSeen - job.postedHoursEarlier * HOUR).toISOString(),
      firstSeenAt: new Date(firstSeen).toISOString(),
    };
  });
}

function filterJobs(jobs: JobItem[], filters: JobFilters, now: number): JobItem[] {
  const today = startOfDayIST(now);
  const q = filters.q?.toLowerCase();
  const matches = jobs.filter((job) => {
    const seen = Date.parse(job.firstSeenAt);
    if (filters.view === "new" && seen < today) return false;
    if (filters.view === "week" && seen < today - 6 * DAY) return false;
    if (filters.view === "all" && Date.parse(job.postedAt) < now - 30 * DAY) return false;
    if (filters.country && job.country !== filters.country) return false;
    if (filters.source && job.source !== filters.source) return false;
    if (q && !job.title.toLowerCase().includes(q) && !job.company.name.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
  return matches.sort(filters.view === "all" ? byNewestPosted : byNewestFirstSeen);
}

function companyItem(company: SampleCompany, jobs: JobItem[], today: number): CompanyItem {
  const posted = jobs.map((job) => job.postedAt).sort();
  return {
    id: company.id,
    name: company.name,
    linkedinUrl: company.linkedin ? `https://linkedin.example/company/${company.slug}` : null,
    openRoles: jobs.length,
    newToday: jobs.filter((job) => Date.parse(job.firstSeenAt) >= today).length,
    latestPostedAt: posted.at(-1) ?? null,
    sources: SOURCES.filter((source) => jobs.some((job) => job.source === source)),
  };
}

function paginate<T>(items: T[], filters: JobFilters): Paged<T> {
  const start = (filters.page - 1) * filters.pageSize;
  return {
    items: items.slice(start, start + filters.pageSize),
    total: items.length,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

function jobUrl(source: JobSource, slug: string, externalId: string): string {
  if (source === "LINKEDIN") return `https://linkedin.example/jobs/view/${slug}-${externalId}`;
  return `https://${source.toLowerCase()}.example/${slug}/jobs/${externalId}`;
}

function byNewestFirstSeen(a: JobItem, b: JobItem): number {
  return b.firstSeenAt.localeCompare(a.firstSeenAt) || b.id.localeCompare(a.id);
}

function byNewestPosted(a: JobItem, b: JobItem): number {
  return b.postedAt.localeCompare(a.postedAt) || b.id.localeCompare(a.id);
}
