import { getSummary } from "@/lib/api";
import { plural } from "@/lib/format";
import type { JobFilters } from "@/lib/types";

/** "4,213 roles · 1,102 companies · 58 countries" for the current view and filters. */
export async function ResultsSummary({ filters }: { filters: JobFilters }) {
  // The page still works without the totals if this call fails.
  const summary = await getSummary(filters).catch(() => null);
  if (!summary) return null;
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      <span className="text-base font-semibold text-foreground tabular-nums">
        {plural(summary.roles, "role", "roles")}
      </span>
      <span aria-hidden> · </span>
      <span className="tabular-nums">{plural(summary.companies, "company", "companies")}</span>
      <span aria-hidden> · </span>
      <span className="tabular-nums">{plural(summary.countries, "country", "countries")}</span>
    </p>
  );
}
