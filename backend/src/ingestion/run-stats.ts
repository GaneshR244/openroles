import type { RunStatus } from '../generated/prisma/enums.js';
import type { BoardLaneStats } from './board-lane.service.js';
import type { FinderStats } from './board-finder.service.js';
import type { BoardImportStats } from './board-import.service.js';
import type { LinkedInStats } from './linkedin-lane.service.js';

/** Shape of FetchRun.stats (docs/ARCHITECTURE.md §3.11). */
export type RunStats = {
  durationMs: number;
  window: { since: string; seconds: number };
  /** Common Crawl board import; null on runs where it wasn't due. */
  boardImport: BoardImportStats | null;
  linkedin: LinkedInStats;
  boards: BoardLaneStats;
  boardsSecondPass: BoardLaneStats | null;
  finder: FinderStats | null;
  retention: { deletedJobs: number; deletedRuns: number };
  totals: { newJobs: number; newCompanies: number };
  partialReasons: string[];
};

/** Board failures above this share of due boards make the run PARTIAL; fewer are normal noise. */
export const BOARD_FAILURE_PARTIAL_SHARE = 0.1;

/** SUCCESS, PARTIAL (something material went wrong) or FAILED (nothing worked). */
export function decideStatus(stats: Omit<RunStats, 'durationMs' | 'partialReasons'>): {
  status: RunStatus;
  reasons: string[];
} {
  const reasons: string[] = [];
  const passes = [stats.boards, stats.boardsSecondPass].filter((p): p is BoardLaneStats => !!p);
  const due = passes.reduce((n, p) => n + p.due, 0);
  const failed = passes.reduce((n, p) => n + p.failed, 0);
  const read = passes.reduce((n, p) => n + p.read, 0);
  if (passes.some((p) => p.stoppedByDeadline) || stats.finder?.stoppedByDeadline) {
    reasons.push('deadline');
  }
  if (stats.linkedin.blocked) reasons.push('linkedin_blocked');
  if (stats.linkedin.provider === 'apify' && stats.linkedin.errors > 0) {
    reasons.push('linkedin_apify_problem');
  }
  if (stats.boardImport && !stats.boardImport.complete) reasons.push('board_import_unfinished');
  if (due > 0 && failed / due > BOARD_FAILURE_PARTIAL_SHARE) reasons.push('many_board_failures');
  const nothingWorked =
    due > 0 && read === 0 && (!stats.linkedin.enabled || stats.linkedin.cards === 0);
  if (nothingWorked) return { status: 'FAILED', reasons: ['no_source_read', ...reasons] };
  return { status: reasons.length ? 'PARTIAL' : 'SUCCESS', reasons };
}
