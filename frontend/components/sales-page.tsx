import { FilterNavigationProvider, PendingArea } from "@/components/filter-navigation";
import { Filters } from "@/components/filters";
import { ModeToggle } from "@/components/mode-toggle";
import { RunStatusBanner } from "@/components/run-status-banner";
import { CompanyResults, JobResults } from "@/components/sales-results";
import { ViewTabs } from "@/components/view-tabs";
import { parseSearchParams, type RawSearchParams } from "@/lib/filters";

/** Everything on the sales page that depends on the URL. Render it inside <Suspense>. */
export async function SalesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { filters, mode } = parseSearchParams(await searchParams);
  return (
    <FilterNavigationProvider filters={filters} mode={mode}>
      <div className="flex flex-col gap-4">
        <RunStatusBanner />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ViewTabs />
          <ModeToggle />
        </div>
        <Filters />
        <PendingArea>
          {mode === "companies" ? (
            <CompanyResults filters={filters} mode={mode} />
          ) : (
            <JobResults filters={filters} mode={mode} />
          )}
        </PendingArea>
      </div>
    </FilterNavigationProvider>
  );
}
