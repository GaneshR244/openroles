import { Ats } from '../generated/prisma/enums.js';

// Pure helpers for the Common Crawl board import (docs/ARCHITECTURE.md, "As built: Common Crawl
// board import"). The service is board-import.service.ts.

/** Hosts whose first path part is a company's board name, e.g. jobs.lever.co/{name}/... */
export const BOARD_HOSTS: readonly { host: string; ats: Ats }[] = [
  { host: 'boards.greenhouse.io', ats: Ats.GREENHOUSE },
  { host: 'job-boards.greenhouse.io', ats: Ats.GREENHOUSE },
  { host: 'jobs.lever.co', ats: Ats.LEVER },
  { host: 'jobs.ashbyhq.com', ats: Ats.ASHBY },
  { host: 'jobs.smartrecruiters.com', ats: Ats.SMARTRECRUITERS },
  { host: 'careers.smartrecruiters.com', ats: Ats.SMARTRECRUITERS },
];

/** Path parts on those hosts that are pages of the site itself, not company boards. */
const NOT_BOARDS = new Set([
  'embed',
  'api',
  'v1',
  'static',
  'assets',
  'search',
  'jobs',
  'login',
  'apply',
  'oneclick-ui',
  'sr-jobs',
  'ui',
  'privacy',
  'terms',
]);
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const FILE = /\.(txt|xml|ico|js|css|png|jpe?g|gif|svg|json|html?|php)$/i;

/** Board names are case-sensitive on Ashby and SmartRecruiters ("Freshworks"), not elsewhere. */
const KEEPS_CASE = new Set<Ats>([Ats.ASHBY, Ats.SMARTRECRUITERS]);

export type BoardRef = { ats: Ats; slug: string };

/** The company board a crawled URL belongs to, or null when the URL isn't one. */
export function boardFromUrl(raw: string): BoardRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const entry = BOARD_HOSTS.find((h) => h.host === url.hostname.toLowerCase());
  if (!entry) return null;

  let slug = decode(url.pathname.split('/').find((part) => part !== '') ?? '');
  // Greenhouse embeds name the board in the query: /embed/job_board?for=acme
  if (entry.ats === Ats.GREENHOUSE && slug.toLowerCase() === 'embed') {
    slug = url.searchParams.get('for') ?? '';
  }
  if (!SLUG.test(slug) || FILE.test(slug) || NOT_BOARDS.has(slug.toLowerCase())) return null;
  return { ats: entry.ats, slug: KEEPS_CASE.has(entry.ats) ? slug : slug.toLowerCase() };
}

/** Same board, whatever the spelling: used to skip boards we already have. */
export function boardKey(board: BoardRef): string {
  return `${board.ats}:${board.slug.toLowerCase()}`;
}

/** "acme-corp" -> "Acme Corp". For boards whose API gives no company name (Lever, Ashby). */
export function nameFromSlug(slug: string): string {
  return slug
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Alternates between systems so every host works at once (each has its own rate limit). */
export function interleaveByAts(boards: readonly BoardRef[]): BoardRef[] {
  const groups = new Map<Ats, BoardRef[]>();
  for (const board of boards) {
    const group = groups.get(board.ats) ?? [];
    group.push(board);
    groups.set(board.ats, group);
  }
  const lists = [...groups.values()];
  const out: BoardRef[] = [];
  for (let i = 0; out.length < boards.length; i++) {
    for (const list of lists) if (i < list.length) out.push(list[i]!);
  }
  return out;
}

/** True when there has never been a complete import, or the last one is `everyDays` old. */
export function importDue(now: Date, lastComplete: Date | null, everyDays: number): boolean {
  if (!lastComplete) return true;
  return now.getTime() - lastComplete.getTime() >= everyDays * 24 * 3600 * 1000;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return '';
  }
}
