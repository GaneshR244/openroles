import type { TestingModule } from '@nestjs/testing';
import { NotFoundError } from '../src/common/http/errors.js';
import { BoardImportService } from '../src/ingestion/board-import.service.js';
import type { RawJob } from '../src/ingestion/sources/source.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestingApp, resetDb } from './helpers/db.js';

const NOW = new Date('2026-11-26T01:00:00Z');
const FAR = new Date(Date.now() + 60 * 60_000);
const API = 'https://index.commoncrawl.org/CC-TEST-index';

/** A fake Common Crawl index: two pages of lever URLs, one ashby page, nothing elsewhere. */
function fakeHttp() {
  const pages: Record<string, string[][]> = {
    'jobs.lever.co': [
      [
        'https://jobs.lever.co/acme/1',
        'https://jobs.lever.co/acme/2',
        'https://jobs.lever.co/robots.txt',
      ],
      ['https://jobs.lever.co/gone-co/9', 'https://jobs.lever.co/quiet/3'],
    ],
    'jobs.ashbyhq.com': [['https://jobs.ashbyhq.com/Mosaic/x', 'https://jobs.ashbyhq.com/known/y']],
  };
  const hostOf = (url: string) => new URL(url).searchParams.get('url')!.replace('/*', '');
  return {
    getJson: vi.fn(async (url: string) => {
      if (url.endsWith('collinfo.json')) return [{ id: 'CC-TEST', 'cdx-api': API }];
      return { pages: (pages[hostOf(url)] ?? []).length };
    }),
    getText: vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      const urls = pages[hostOf(url)]?.[page] ?? [];
      return urls.map((u) => JSON.stringify({ url: u })).join('\n') + '\n{not json\n';
    }),
  };
}

const job = (companyName?: string): RawJob => ({
  source: 'LEVER',
  externalId: '1',
  title: 'Engineer',
  companyName,
  locations: ['Berlin, Germany'],
  countryCodes: [],
  url: 'https://jobs.lever.co/x/1',
});

/** Fake readers: acme and Mosaic have jobs, quiet has none, gone-co is a 404. */
const readers = {
  get: () => ({
    read: async (slug: string) => {
      if (slug === 'gone-co') throw new NotFoundError(`https://api.lever.co/v0/postings/${slug}`);
      if (slug === 'quiet') return { jobs: [], truncated: false };
      return { jobs: [job()], truncated: false };
    },
  }),
};

describe('BoardImportService (integration, real PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await createTestingApp([]);
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('adds boards with open jobs from the crawl, skipping known, empty and gone boards', async () => {
    // "known" is already a board; "Mosaic" is a company name already used by another board.
    const other = await prisma.company.create({
      data: { name: 'Mosaic', normalizedName: 'mosaic', discoveredVia: 'yc' },
    });
    await prisma.board.create({ data: { ats: 'LEVER', slug: 'mosaic', companyId: other.id } });
    await prisma.board.create({ data: { ats: 'ASHBY', slug: 'known', companyId: other.id } });

    const service = new BoardImportService(fakeHttp() as never, readers as never, prisma);
    const stats = await service.run({ now: NOW, deadline: FAR });

    expect(stats).toMatchObject({
      crawls: ['CC-TEST'],
      cdxPages: 3,
      boardsFound: 5, // acme, gone-co, quiet, Mosaic, known
      alreadyKnown: 1,
      checked: 4,
      added: 2,
      noJobs: 1,
      notFound: 1,
      errors: 0,
      complete: true,
    });

    const boards = await prisma.board.findMany({
      where: { companyId: { not: other.id } },
      include: { company: true },
      orderBy: { ats: 'asc' }, // enum order: LEVER before ASHBY
    });
    expect(boards.map((b) => [b.ats, b.slug, b.company.name, b.company.normalizedName])).toEqual([
      ['LEVER', 'acme', 'Acme', 'acme'],
      ['ASHBY', 'Mosaic', 'Mosaic', 'mosaic #ashby:mosaic'], // kept apart from the other Mosaic
    ]);
    expect(boards.every((b) => b.nextFetchAt <= NOW)).toBe(true); // the board lane reads them now
    expect(boards.every((b) => b.company.discoveredVia === 'commoncrawl')).toBe(true);
  });

  it('a second import adds nothing new', async () => {
    const service = new BoardImportService(fakeHttp() as never, readers as never, prisma);
    await service.run({ now: NOW, deadline: FAR });
    const again = await service.run({ now: NOW, deadline: FAR });
    expect(again).toMatchObject({ added: 0, alreadyKnown: 3, checked: 2 });
    expect(await prisma.board.count()).toBe(3);
  });

  it('links a board to an existing company that has no board yet', async () => {
    const yc = await prisma.company.create({
      data: { name: 'Acme', normalizedName: 'acme', discoveredVia: 'yc' },
    });
    const service = new BoardImportService(fakeHttp() as never, readers as never, prisma);
    await service.run({ now: NOW, deadline: FAR });
    const board = await prisma.board.findFirstOrThrow({ where: { slug: 'acme' } });
    expect(board.companyId).toBe(yc.id);
  });

  it('stops at the deadline and reports the import as not complete', async () => {
    const service = new BoardImportService(fakeHttp() as never, readers as never, prisma);
    const stats = await service.run({ now: NOW, deadline: new Date(Date.now() - 1) });
    expect(stats.complete).toBe(false);
    expect(stats.stoppedByDeadline).toBe(true);
  });

  it('reports Common Crawl being down without throwing', async () => {
    const http = fakeHttp();
    http.getJson.mockRejectedValueOnce(new Error('502 Bad Gateway'));
    const service = new BoardImportService(http as never, readers as never, prisma);
    const stats = await service.run({ now: NOW, deadline: FAR });
    expect(stats).toMatchObject({ crawls: [], cdxErrors: 1, complete: false });
  });

  it('is due monthly, counting only complete imports', async () => {
    const service = new BoardImportService(fakeHttp() as never, readers as never, prisma);
    expect(await service.isDue(NOW)).toBe(true);
    await prisma.fetchRun.create({
      data: {
        status: 'SUCCESS',
        startedAt: new Date('2026-11-20T00:30:00Z'),
        stats: { boardImport: { complete: false } },
      },
    });
    expect(await service.isDue(NOW)).toBe(true);
    await prisma.fetchRun.create({
      data: {
        status: 'SUCCESS',
        startedAt: new Date('2026-11-21T00:30:00Z'),
        stats: { boardImport: { complete: true } },
      },
    });
    expect(await service.isDue(NOW)).toBe(false);
    expect(await service.isDue(new Date('2026-12-22T00:30:00Z'))).toBe(true);
  });
});
