import { CompaniesTable } from "@/components/companies-table";
import { EmptyState } from "@/components/empty-state";
import { JobsTable } from "@/components/jobs-table";
import { ResultsPagination } from "@/components/results-pagination";
import { getCompanies, getJobs } from "@/lib/api";
import { clearFilters, hasActiveFilters, salesPageHref, type PageState } from "@/lib/filters";
import { requestNow } from "@/lib/now";

export async function JobResults({ filters, mode }: PageState) {
  const [result, now] = await Promise.all([getJobs(filters), requestNow()]);
  if (result.items.length === 0) return <NoResults filters={filters} mode={mode} total={result.total} />;
  return (
    <>
      <JobsTable jobs={result.items} now={now} />
      <ResultsPagination filters={filters} mode={mode} total={result.total} noun={["role", "roles"]} />
    </>
  );
}

export async function CompanyResults({ filters, mode }: PageState) {
  const [result, now] = await Promise.all([getCompanies(filters), requestNow()]);
  if (result.items.length === 0) return <NoResults filters={filters} mode={mode} total={result.total} />;
  return (
    <>
      <CompaniesTable companies={result.items} now={now} />
      <ResultsPagination
        filters={filters}
        mode={mode}
        total={result.total}
        noun={["company", "companies"]}
      />
    </>
  );
}

function NoResults({ filters, mode, total }: PageState & { total: number }) {
  if (total > 0) {
    return (
      <EmptyState
        title="This page is empty"
        description="There are fewer results than this page number."
        action={{ href: salesPageHref({ ...filters, page: 1 }, mode), label: "Go to the first page" }}
      />
    );
  }
  if (hasActiveFilters(filters)) {
    return (
      <EmptyState
        title="No roles match these filters"
        description="Try another country or source, or a shorter search."
        action={{ href: salesPageHref(clearFilters(filters), mode), label: "Reset filters" }}
      />
    );
  }
  if (filters.view === "new") {
    return (
      <EmptyState
        title="No new roles yet today"
        description="New roles appear after the daily run each morning."
        action={{
          href: salesPageHref({ ...filters, view: "week", page: 1 }, mode),
          label: "See the last 7 days",
        }}
      />
    );
  }
  return (
    <EmptyState
      title="No open roles yet"
      description="Roles appear here after the first daily run."
    />
  );
}
