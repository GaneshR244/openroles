import { readFileSync } from 'node:fs';
import { cleanCompanyUrl, parseLinkedInSearch } from './linkedin.parser.js';

const fixture = () =>
  readFileSync(new URL('../../../test/fixtures/linkedin-search.html', import.meta.url), 'utf8');

describe('parseLinkedInSearch', () => {
  it('reads every card and builds clean job links', () => {
    const page = parseLinkedInSearch(fixture());
    expect(page.cards).toBe(5);
    expect(page.looksBlocked).toBe(false);
    expect(page.jobs[0]).toEqual({
      source: 'LINKEDIN',
      externalId: '4330222739',
      title: 'Sr Application Engineer',
      companyName: 'Cadence',
      companyLinkedinUrl: 'https://www.linkedin.com/company/cadence-design-systems',
      locations: ['Bengaluru, Karnataka, India'],
      countryCodes: [],
      url: 'https://www.linkedin.com/jobs/view/4330222739',
      postedAt: new Date('2026-11-24T00:00:00Z'),
    });
  });

  it('handles the "new" date class, plain-text company names and skips unusable cards', () => {
    const { jobs } = parseLinkedInSearch(fixture());
    expect(jobs.map((j) => j.externalId)).toEqual([
      '4330222739',
      '4331000001',
      '4331000002',
      '4330222739',
    ]);
    expect(jobs[1]!.postedAt).toEqual(new Date('2026-11-25T00:00:00Z'));
    expect(jobs[2]).toMatchObject({
      companyName: 'Brightpath Health',
      companyLinkedinUrl: undefined,
    });
  });

  it('treats an empty body as the end of results, not a block', () => {
    expect(parseLinkedInSearch('')).toEqual({ jobs: [], cards: 0, looksBlocked: false });
  });

  it('recognises a bot-check page (script, no job cards) as blocked', () => {
    const challenge = '<html><script>var _0x26bb58=_0x3a5d;function _0x2511(){}</script></html>';
    expect(parseLinkedInSearch(challenge).looksBlocked).toBe(true);
  });

  it('cleans company page links', () => {
    expect(cleanCompanyUrl('https://in.linkedin.com/company/acme/?trk=x')).toBe(
      'https://www.linkedin.com/company/acme',
    );
    expect(cleanCompanyUrl('https://example.com/company/acme')).toBeUndefined();
    expect(cleanCompanyUrl(undefined)).toBeUndefined();
  });
});
