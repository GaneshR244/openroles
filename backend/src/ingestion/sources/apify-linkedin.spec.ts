import { readFileSync } from 'node:fs';
import {
  apifyInput,
  apifyItemToRawJob,
  apifySearchUrl,
  remainingToday,
} from './apify-linkedin.js';
import { apifyLinkedInJobSchema } from './schemas.js';

// The fixture follows the field list and sample on the actor's page
// (apify.com/curious_coder/linkedin-jobs-scraper). Replace it with a saved real response after
// the first live run.
const items = JSON.parse(
  readFileSync(new URL('../../../test/fixtures/apify-linkedin.json', import.meta.url), 'utf8'),
) as unknown[];

describe('apifySearchUrl / apifyInput', () => {
  it('builds a public search link for one place and window', () => {
    expect(apifySearchUrl('United Arab Emirates', 86400)).toBe(
      'https://www.linkedin.com/jobs/search/?location=United+Arab+Emirates&f_TPR=r86400',
    );
  });

  it('splits the limit across searches and skips the extra company pages', () => {
    expect(apifyInput(['India', 'United Arab Emirates', 'United States'], 50, 86400)).toEqual({
      urls: [
        'https://www.linkedin.com/jobs/search/?location=India&f_TPR=r86400',
        'https://www.linkedin.com/jobs/search/?location=United+Arab+Emirates&f_TPR=r86400',
        'https://www.linkedin.com/jobs/search/?location=United+States&f_TPR=r86400',
      ],
      limitPerSource: 17,
      scrapeCompany: false,
      splitByLocation: false,
    });
    expect(apifyInput(['India'], 1, 86400).limitPerSource).toBe(1);
  });
});

describe('remainingToday', () => {
  it.each([
    [50, 0, 50],
    [50, 30, 20],
    [50, 50, 0],
    [50, 80, 0],
  ])('limit %i, used %i -> %i left', (limit, used, left) => {
    expect(remainingToday(limit, used)).toBe(left);
  });
});

describe('apify LinkedIn items', () => {
  it('accepts real-shaped items and rejects one without a title', () => {
    const results = items.map((item) => apifyLinkedInJobSchema.safeParse(item).success);
    expect(results).toEqual([true, true, true, false]);
  });

  it('keeps only our fields, with a clean job link and company page', () => {
    const job = apifyItemToRawJob(apifyLinkedInJobSchema.parse(items[0]));
    expect(job).toEqual({
      source: 'LINKEDIN',
      externalId: '4330222739',
      title: 'Sr Application Engineer',
      companyName: 'Cadence',
      companyLinkedinUrl: 'https://www.linkedin.com/company/cadence-design-systems',
      locations: ['Bengaluru, Karnataka, India'],
      countryCodes: [],
      url: 'https://www.linkedin.com/jobs/view/4330222739',
      postedAt: new Date('2026-11-25T00:00:00Z'),
    });
    // Recruiter details and descriptions are never carried over.
    expect(Object.keys(job)).not.toContain('jobPosterName');
  });

  it('reads numeric ids, timestamps and missing values', () => {
    const uae = apifyItemToRawJob(apifyLinkedInJobSchema.parse(items[1]));
    expect(uae.externalId).toBe('4331000001');
    expect(uae.postedAt).toEqual(new Date(1795651200000));
    const nurse = apifyItemToRawJob(apifyLinkedInJobSchema.parse(items[2]));
    expect(nurse.companyLinkedinUrl).toBeUndefined();
    expect(nurse.postedAt).toBeUndefined();
  });
});
