import { Ats } from '../generated/prisma/enums.js';
import {
  boardFromUrl,
  boardKey,
  importDue,
  interleaveByAts,
  nameFromSlug,
} from './board-import.js';

describe('boardFromUrl', () => {
  it.each<[string, { ats: Ats; slug: string } | null]>([
    ['https://boards.greenhouse.io/stripe/jobs/123', { ats: Ats.GREENHOUSE, slug: 'stripe' }],
    ['https://job-boards.greenhouse.io/Figma', { ats: Ats.GREENHOUSE, slug: 'figma' }],
    [
      'https://boards.greenhouse.io/embed/job_board?for=acme&b=x',
      { ats: Ats.GREENHOUSE, slug: 'acme' },
    ],
    ['https://jobs.lever.co/cred/af4cc539-ea8b', { ats: Ats.LEVER, slug: 'cred' }],
    ['http://jobs.lever.co/Acme-Corp/', { ats: Ats.LEVER, slug: 'acme-corp' }],
    // Ashby and SmartRecruiters names keep their case
    ['https://jobs.ashbyhq.com/Ramp/34413f8d', { ats: Ats.ASHBY, slug: 'Ramp' }],
    [
      'https://jobs.smartrecruiters.com/Freshworks/744000163610179',
      { ats: Ats.SMARTRECRUITERS, slug: 'Freshworks' },
    ],
    ['https://careers.smartrecruiters.com/Visa', { ats: Ats.SMARTRECRUITERS, slug: 'Visa' }],
    // site pages and files, not boards
    ['https://jobs.lever.co/robots.txt', null],
    ['https://jobs.ashbyhq.com/api/non-user-graphql', null],
    ['https://boards.greenhouse.io/embed/job_board/js', null],
    ['https://boards.greenhouse.io/', null],
    ['https://jobs.smartrecruiters.com/oneclick-ui/x', null],
    // other hosts and broken URLs
    ['https://www.lever.co/careers', null],
    ['https://example.com/stripe', null],
    ['not a url', null],
    ['https://jobs.lever.co/%E0%A4%A', null],
  ])('%s -> %j', (url, expected) => {
    expect(boardFromUrl(url)).toEqual(expected);
  });
});

describe('boardKey', () => {
  it('ignores case, so known boards are skipped whatever the spelling', () => {
    expect(boardKey({ ats: Ats.ASHBY, slug: 'Ramp' })).toBe(
      boardKey({ ats: Ats.ASHBY, slug: 'ramp' }),
    );
    expect(boardKey({ ats: Ats.ASHBY, slug: 'ramp' })).not.toBe(
      boardKey({ ats: Ats.LEVER, slug: 'ramp' }),
    );
  });
});

describe('nameFromSlug', () => {
  it.each([
    ['acme-corp', 'Acme Corp'],
    ['acme_corp.io', 'Acme Corp Io'],
    ['Ramp', 'Ramp'],
    ['cred', 'Cred'],
  ])('%s -> %s', (slug, name) => {
    expect(nameFromSlug(slug)).toBe(name);
  });
});

describe('interleaveByAts', () => {
  it('alternates systems and keeps every board', () => {
    const gh = (s: string) => ({ ats: Ats.GREENHOUSE, slug: s });
    const lv = (s: string) => ({ ats: Ats.LEVER, slug: s });
    expect(interleaveByAts([gh('a'), gh('b'), gh('c'), lv('x')])).toEqual([
      gh('a'),
      lv('x'),
      gh('b'),
      gh('c'),
    ]);
    expect(interleaveByAts([])).toEqual([]);
  });
});

describe('importDue', () => {
  const now = new Date('2026-11-26T06:00:00Z');
  it('is due with no complete import, or after 30 days', () => {
    expect(importDue(now, null, 30)).toBe(true);
    expect(importDue(now, new Date('2026-10-27T06:00:00Z'), 30)).toBe(true);
    expect(importDue(now, new Date('2026-11-01T06:00:00Z'), 30)).toBe(false);
  });
});
