import { cn } from "@/lib/utils";
import { getRunSummary } from "@/lib/api";
import { formatRunTime, plural } from "@/lib/format";
import { requestNow } from "@/lib/now";
import type { RunSummary } from "@/lib/types";

type Tone = "ok" | "running" | "idle" | "warning" | "error";

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  running: "bg-sky-500 animate-pulse",
  idle: "bg-muted-foreground/40",
  warning: "bg-amber-500",
  error: "bg-destructive",
};

/** "Updated today 06:14 IST · N new roles at M companies" */
export async function RunStatusBanner() {
  const [summary, now] = await Promise.all([getRunSummary(), requestNow()]);
  const { tone, text } = describeRun(summary, now);
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <span>{text}</span>
    </p>
  );
}

function describeRun({ lastRun, isRunning, today }: RunSummary, now: number): { tone: Tone; text: string } {
  const lastUpdate = lastRun ? formatRunTime(lastRun.finishedAt ?? lastRun.startedAt, now) : null;

  if (isRunning) {
    return {
      tone: "running",
      text: lastUpdate ? `Collecting jobs now… · last updated ${lastUpdate}` : "Collecting jobs now…",
    };
  }
  if (!lastRun || !lastUpdate) return { tone: "idle", text: "No run yet" };
  if (lastRun.status === "FAILED") {
    return { tone: "error", text: `The last run failed (${lastUpdate}) · showing roles from earlier runs` };
  }

  const counts = `${plural(today.newJobs, "new role", "new roles")} at ${plural(today.companies, "company", "companies")}`;
  if (lastRun.status === "PARTIAL") {
    return { tone: "warning", text: `Updated ${lastUpdate} · ${counts} · some sources were skipped` };
  }
  return { tone: "ok", text: `Updated ${lastUpdate} · ${counts}` };
}
