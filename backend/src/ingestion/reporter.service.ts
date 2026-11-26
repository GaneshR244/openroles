import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AppConfig, setting } from '../config/app-config.js';
import type { RunStatus } from '../generated/prisma/enums.js';
import type { RunStats } from './run-stats.js';

// Run summary: one log line, and a Slack message when SLACK_WEBHOOK_URL is set (§6).

const ANOMALY_SHARE = 0.2; // alert when new jobs fall under 20% of the recent average
const ANOMALY_MIN_AVERAGE = 20; // ...and only once there is a meaningful average
const MOVING_AVERAGE_RUNS = 7;

/** Moving-average check that catches silent breakage (a source quietly returning nothing). */
export function isAnomaly(newJobs: number, previous: readonly number[]): boolean {
  if (previous.length < 3) return false;
  const avg = previous.reduce((a, b) => a + b, 0) / previous.length;
  return avg >= ANOMALY_MIN_AVERAGE && newJobs < avg * ANOMALY_SHARE;
}

const fmt = (n: number) => n.toLocaleString('en-IN');

export function summaryText(
  status: RunStatus,
  stats: RunStats,
  startedAt: Date,
  anomaly: boolean,
): string {
  const day = startedAt.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  });
  const mins = Math.round(stats.durationMs / 60000);
  // Both board passes together (the second pass reads boards found during this run).
  const passes = [stats.boards, stats.boardsSecondPass].filter((p) => p !== null);
  const sum = (key: 'due' | 'read' | 'unchanged' | 'failed' | 'closed') =>
    passes.reduce((n, p) => n + p[key], 0);
  const b = {
    due: sum('due'),
    read: sum('read'),
    unchanged: sum('unchanged'),
    failed: sum('failed'),
    closed: sum('closed'),
  };
  const lines = [
    `OpenRoles ${day} · ${status} in ${mins} min · ${fmt(stats.totals.newJobs)} new roles · ${fmt(stats.totals.newCompanies)} new companies`,
    `Boards: ${fmt(b.due)} due · ${fmt(b.read)} read · ${fmt(b.unchanged)} unchanged · ${fmt(b.failed)} failed · ${fmt(b.closed)} jobs closed`,
    stats.linkedin.enabled
      ? `LinkedIn: ${fmt(stats.linkedin.requests)} requests · ${fmt(stats.linkedin.cards)} cards · ${stats.linkedin.blocked ? 'BLOCKED' : 'not blocked'}`
      : 'LinkedIn: off',
    stats.boardImport
      ? `Board import (Common Crawl): ${fmt(stats.boardImport.boardsFound)} boards found · ${fmt(stats.boardImport.checked)} checked · ${fmt(stats.boardImport.added)} added${stats.boardImport.complete ? '' : ' · not finished, continues next run'}`
      : '',
    stats.finder
      ? `Board finder: ${fmt(stats.finder.probedCompanies)} companies checked · ${fmt(stats.finder.boardsFound)} new boards`
      : '',
  ];
  if (stats.partialReasons.length) lines.push(`Needs a look: ${stats.partialReasons.join(', ')}`);
  if (anomaly)
    lines.push('Alert: far fewer new roles than the recent average. A source may have broken.');
  return lines.filter(Boolean).join('\n');
}

@Injectable()
export class ReporterService {
  private readonly logger = new Logger(ReporterService.name);
  private readonly config: AppConfig;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.config = config as unknown as AppConfig;
  }

  async report(
    runId: string,
    status: RunStatus,
    stats: RunStats,
    startedAt: Date,
  ): Promise<string> {
    const previous = await this.previousNewJobs(runId);
    const anomaly = isAnomaly(stats.totals.newJobs, previous);
    const text = summaryText(status, stats, startedAt, anomaly);
    this.logger.log(text.replace(/\n/g, ' | '));

    const hook = setting(this.config, 'SLACK_WEBHOOK_URL');
    if (hook) await this.postToSlack(hook, text);
    return text;
  }

  /** Short Slack alert for a run that failed outright (no summary to send). */
  async alertFailure(message: string): Promise<void> {
    const hook = setting(this.config, 'SLACK_WEBHOOK_URL');
    if (hook) await this.postToSlack(hook, `OpenRoles run FAILED: ${message.slice(0, 500)}`);
  }

  private async previousNewJobs(runId: string): Promise<number[]> {
    const runs = await this.prisma.fetchRun.findMany({
      where: { id: { not: runId }, status: { in: ['SUCCESS', 'PARTIAL'] } },
      orderBy: { startedAt: 'desc' },
      take: MOVING_AVERAGE_RUNS,
      select: { stats: true },
    });
    return runs
      .map((r) => (r.stats as { totals?: { newJobs?: number } } | null)?.totals?.newJobs)
      .filter((n): n is number => typeof n === 'number');
  }

  /** Slack is a notification, not a job source, so it is called directly with a short timeout. */
  private async postToSlack(url: string, text: string): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) this.logger.warn(`Slack webhook answered HTTP ${res.status}`);
    } catch (err) {
      this.logger.warn(`Slack webhook failed: ${(err as Error).message}`);
    }
  }
}
