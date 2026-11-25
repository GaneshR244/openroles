import { load } from 'cheerio';
import { JobSource } from '../../generated/prisma/enums.js';
import type { RawJob } from './source.types.js';

// Parses one page of LinkedIn's logged-out job search (docs/ARCHITECTURE.md §3.3, §3.10).
// Selectors verified against a live response on 25 Nov 2026:
//   card     [data-entity-urn="urn:li:jobPosting:{id}"]
//   title    .base-search-card__title
//   company  .base-search-card__subtitle (link = company page)
//   location .job-search-card__location
//   date     time[datetime]

export type LinkedInPage = {
  jobs: RawJob[];
  /** Cards on the page, including duplicates and unusable ones; used to move `start` forward. */
  cards: number;
  /** A non-empty page with no job cards, e.g. LinkedIn's bot-check script. Treat as blocked. */
  looksBlocked: boolean;
};

const URN_PREFIX = 'urn:li:jobPosting:';

/** "https://in.linkedin.com/company/acme?trk=x" → "https://www.linkedin.com/company/acme" */
export function cleanCompanyUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    if (!url.hostname.endsWith('linkedin.com') || !url.pathname.startsWith('/company/'))
      return undefined;
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
}

const text = (value: string | undefined) => value?.replace(/\s+/g, ' ').trim() ?? '';

export function parseLinkedInSearch(html: string): LinkedInPage {
  const $ = load(html);
  const cards = $(`[data-entity-urn^="${URN_PREFIX}"]`);
  const jobs: RawJob[] = [];

  cards.each((_, el) => {
    const card = $(el);
    const id = card.attr('data-entity-urn')!.slice(URN_PREFIX.length).trim();
    const title = text(card.find('.base-search-card__title').first().text());
    const subtitle = card.find('.base-search-card__subtitle').first();
    const companyName = text(subtitle.text());
    const location = text(card.find('.job-search-card__location').first().text());
    const datetime = card.find('time[datetime]').first().attr('datetime');
    if (!/^\d+$/.test(id) || !title || !companyName) return;

    const postedAt = datetime ? new Date(`${datetime}T00:00:00Z`) : undefined;
    jobs.push({
      source: JobSource.LINKEDIN,
      externalId: id,
      title,
      companyName,
      companyLinkedinUrl: cleanCompanyUrl(subtitle.find('a').first().attr('href')),
      locations: location ? [location] : [],
      countryCodes: [],
      url: `https://www.linkedin.com/jobs/view/${id}`,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    });
  });

  const looksBlocked = cards.length === 0 && html.trim().length > 0 && !/<li[\s>]/i.test(html);
  return { jobs, cards: cards.length, looksBlocked };
}
