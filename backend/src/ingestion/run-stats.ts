import type { RunStatus } from '../generated/prisma/enums.js';
import type { BoardLaneStats } from './board-lane.service.js';
import type { FinderStats } from './board-finder.service.js';

/** Shape of FetchRun.stats (docs/ARCHITECTURE.md §3.11). */
export type RunStats = {
  durationMs: number;
  window: { since: string; seconds: number };
  linkedin: {
    enabled: boolean;
    requests: number;
    cards: number;
    new: number;
    saturated: string[];
    blocked: boolean;
  };
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
  const b = stats.boards;
  if (b.stoppedByDeadline || stats.finder?.stoppedByDeadline) reasons.push('deadline');
  if (stats.linkedin.blocked) reasons.push('linkedin_blocked');
  if (b.due > 0 && b.failed / b.due > BOARD_FAILURE_PARTIAL_SHARE)
    reasons.push('many_board_failures');
  const nothingWorked =
    b.due > 0 && b.read === 0 && (!stats.linkedin.enabled || stats.linkedin.cards === 0);
  if (nothingWorked) return { status: 'FAILED', reasons: ['no_source_read', ...reasons] };
  return { status: reasons.length ? 'PARTIAL' : 'SUCCESS', reasons };
}
