import { Skeleton } from "@/components/ui/skeleton";

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border" aria-hidden>
      <div className="flex gap-4 border-b bg-muted/50 px-3 py-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="hidden h-4 w-24 sm:block" />
        <Skeleton className="hidden h-4 w-16 md:block" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-3 py-3 last:border-0">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
          <Skeleton className="hidden h-5 w-20 rounded-full md:block" />
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for the banner, tabs, filters and table on the sales page. */
export function SalesPageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading roles">
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-full sm:w-72" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
      </div>
      <TableSkeleton />
    </div>
  );
}

/** Placeholder for a company's header and roles. */
export function CompanySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading company">
      <Skeleton className="h-7 w-64 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <TableSkeleton rows={5} />
    </div>
  );
}
