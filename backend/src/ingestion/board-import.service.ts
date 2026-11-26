import { Injectable, Logger } from '@nestjs/common';
import { HttpClient } from '../common/http/http-client.js';
import { NotFoundError } from '../common/http/errors.js';
import { runPool } from '../common/pool.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  BOARD_HOSTS,
  type BoardRef,
  boardFromUrl,
  boardKey,
  importDue,
  interleaveByAts,
  nameFromSlug,
} from './board-import.js';
import { normalizeCompany } from './pipeline/normalize.js';
import { BoardReaders } from './sources/board-readers.js';
import {
  cdxPagesSchema,
  cdxRecordSchema,
  commonCrawlCollectionsSchema,
  parseResponse,
} from './sources/schemas.js';
import type { ReadOptions } from './sources/source.types.js';

// Common Crawl board import (docs/ARCHITECTURE.md, "As built: Common Crawl board import").
// Greenhouse, Lever, Ashby and SmartRecruiters have no "list every company" API, so we find
// company boards in Common Crawl, the free public web archive: every crawled URL on
// jobs.lever.co/{name}, jobs.ashbyhq.com/{name} and so on names a board. Each new board is
// checked once with one read; boards with open jobs are saved and the board lane reads them.

const COLLINFO_URL = 'https://index.commoncrawl.org/collinfo.json';
/** Newest crawls to scan. Each crawl misses some boards, so two give better coverage. */
const CRAWLS = 2;
/** Refresh the board list once a month. */
export const IMPORT_EVERY_DAYS = 30;
/** Most new boards checked in one run; the rest wait for the next run. */
const MAX_CHECKS = 40_000;
/** The import gets at most this much of the run, so the lanes still have time. */
const MAX_MINUTES = 45;
/** Boards checked at once. HttpClient still limits each host (4 at a time for the ATS APIs). */
const WORKERS = 16;
/** The Common Crawl index is slow and sometimes busy: long timeouts, a few tries. */
const CDX_REQUEST = { timeoutMs: 90_000, maxAttempts: 4 };
/** One quick read per board: first page only, short timeout. */
const CHECK_READ: ReadOptions = { timeoutMs: 10_000, maxAttempts: 2, maxPages: 1 };

export type BoardImportStats = {
  crawls: string[];
  cdxPages: number;
  cdxErrors: number;
  urls: number;
  /** Distinct boards named in the crawls. */
  boardsFound: number;
  alreadyKnown: number;
  checked: number;
  added: number;
  noJobs: number;
  notFound: number;
  errors: number;
  stoppedByDeadline: boolean;
  /** Every new board was checked. Until then the import runs again the next morning. */
  complete: boolean;
};

export function emptyImportStats(): BoardImportStats {
  return {
    crawls: [],
    cdxPages: 0,
    cdxErrors: 0,
    urls: 0,
    boardsFound: 0,
    alreadyKnown: 0,
    checked: 0,
    added: 0,
    noJobs: 0,
    notFound: 0,
    errors: 0,
    stoppedByDeadline: false,
    complete: false,
  };
}

@Injectable()
export class BoardImportService {
  private readonly logger = new Logger(BoardImportService.name);

  constructor(
    private readonly http: HttpClient,
    private readonly readers: BoardReaders,
    private readonly prisma: PrismaService,
  ) {}

  /** Due when no run finished a complete import in the last 30 days. */
  async isDue(now: Date): Promise<boolean> {
    const last = await this.prisma.fetchRun.findFirst({
      where: { stats: { path: ['boardImport', 'complete'], equals: true } },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });
    return importDue(now, last?.startedAt ?? null, IMPORT_EVERY_DAYS);
  }

  async run(opts: { now: Date; deadline: Date }): Promise<BoardImportStats> {
    const stats = emptyImportStats();
    const stopAt = Math.min(opts.deadline.getTime(), Date.now() + MAX_MINUTES * 60_000);
    const pastDeadline = () => {
      const stop = Date.now() >= stopAt;
      if (stop) stats.stoppedByDeadline = true;
      return stop;
    };

    const found = new Map<string, BoardRef>();
    let crawls: { id: string; api: string }[];
    try {
      crawls = await this.latestCrawls();
    } catch (err) {
      stats.cdxErrors++;
      this.logger.warn(`board import: Common Crawl unavailable: ${(err as Error).message}`);
      return stats;
    }
    stats.crawls = crawls.map((c) => c.id);
    for (const crawl of crawls) {
      for (const { host } of BOARD_HOSTS) {
        if (pastDeadline()) break;
        await this.scanHost(crawl.api, host, found, stats, pastDeadline);
      }
    }
    stats.boardsFound = found.size;

    const known = new Set(
      (await this.prisma.board.findMany({ select: { ats: true, slug: true } })).map(boardKey),
    );
    const fresh = [...found.values()].filter((b) => !known.has(boardKey(b)));
    stats.alreadyKnown = found.size - fresh.length;
    const toCheck = interleaveByAts(fresh).slice(0, MAX_CHECKS);

    await runPool(
      toCheck,
      WORKERS,
      (board) => this.check(board, opts.now, stats),
      pastDeadline,
      (board, err) => {
        if (err instanceof NotFoundError) stats.notFound++;
        else {
          stats.errors++;
          this.logger.debug(`board import ${board.ats}/${board.slug}: ${(err as Error)?.message}`);
        }
      },
    );

    stats.complete = !stats.stoppedByDeadline && toCheck.length === fresh.length;
    this.logger.log(
      `board import: ${stats.crawls.length} crawls · ${stats.cdxPages} index pages · ` +
        `${stats.boardsFound} boards found · ${stats.alreadyKnown} known · ${stats.checked} checked · ` +
        `${stats.added} added · ${stats.noJobs} without jobs · ${stats.notFound} gone · ` +
        `${stats.errors} errors${stats.complete ? '' : ' · NOT COMPLETE'}`,
    );
    return stats;
  }

  private async latestCrawls(): Promise<{ id: string; api: string }[]> {
    const data = parseResponse(
      commonCrawlCollectionsSchema,
      await this.http.getJson(COLLINFO_URL, CDX_REQUEST),
      COLLINFO_URL,
    );
    return data.slice(0, CRAWLS).map((c) => ({ id: c.id, api: c['cdx-api'] }));
  }

  /** Reads every index page for one host in one crawl and collects the boards it names. */
  private async scanHost(
    api: string,
    host: string,
    found: Map<string, BoardRef>,
    stats: BoardImportStats,
    pastDeadline: () => boolean,
  ): Promise<void> {
    const query = new URLSearchParams({ url: `${host}/*`, output: 'json', fl: 'url' });
    let pages: number;
    try {
      const url = `${api}?${query}&showNumPages=true`;
      pages = parseResponse(cdxPagesSchema, await this.http.getJson(url, CDX_REQUEST), url).pages;
    } catch (err) {
      stats.cdxErrors++;
      this.logger.warn(`board import: ${host} page count failed: ${(err as Error).message}`);
      return;
    }

    for (let page = 0; page < pages && !pastDeadline(); page++) {
      try {
        const text = await this.http.getText(`${api}?${query}&page=${page}`, CDX_REQUEST);
        stats.cdxPages++;
        for (const line of text.split('\n')) {
          const record = cdxRecordSchema.safeParse(parseLine(line));
          if (!record.success) continue;
          stats.urls++;
          const board = boardFromUrl(record.data.url);
          if (board && !found.has(boardKey(board))) found.set(boardKey(board), board);
        }
      } catch (err) {
        stats.cdxErrors++;
        this.logger.warn(`board import: ${host} page ${page} failed: ${(err as Error).message}`);
      }
    }
  }

  /** One read: a board with open jobs is saved (with its company), the board lane reads it. */
  private async check(board: BoardRef, now: Date, stats: BoardImportStats): Promise<void> {
    stats.checked++;
    const { jobs } = await this.readers.get(board.ats).read(board.slug, CHECK_READ);
    if (jobs.length === 0) {
      stats.noJobs++;
      return;
    }
    const name = jobs.find((j) => j.companyName?.trim())?.companyName?.trim();
    const companyId = await this.companyFor(name || nameFromSlug(board.slug), board, now);
    const created = await this.prisma.board.createMany({
      data: [{ ats: board.ats, slug: board.slug, companyId, nextFetchAt: now }],
      skipDuplicates: true,
    });
    stats.added += created.count;
  }

  /**
   * The company for a new board: an existing company with that name and no board yet, or a new
   * one. If the name is taken by a company that already has its own board, the two are kept
   * apart (same name, different companies is common: "Mosaic", "Atlas").
   */
  private async companyFor(name: string, board: BoardRef, now: Date): Promise<string> {
    const normalizedName = normalizeCompany(name) || board.slug.toLowerCase();
    const existing = await this.prisma.company.findUnique({
      where: { normalizedName },
      select: { id: true, _count: { select: { boards: true } } },
    });
    if (existing && existing._count.boards === 0) return existing.id;

    const key = existing ? `${normalizedName} #${boardKey(board).toLowerCase()}` : normalizedName;
    const company = await this.prisma.company.upsert({
      where: { normalizedName: key },
      create: { name, normalizedName: key, discoveredVia: 'commoncrawl', boardsCheckedAt: now },
      update: {},
      select: { id: true },
    });
    return company.id;
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
