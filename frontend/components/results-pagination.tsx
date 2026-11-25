import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/components/ui/pagination";
import { salesPageHref, type Mode } from "@/lib/filters";
import { formatCount } from "@/lib/format";
import type { JobFilters } from "@/lib/types";

type ResultsPaginationProps = {
  filters: JobFilters;
  mode: Mode;
  total: number;
  /** What is being counted, e.g. ["role", "roles"]. */
  noun: [one: string, many: string];
};

/** "Showing 1–50 of 312 roles" plus page links. Links keep every other filter. */
export function ResultsPagination({ filters, mode, total, noun }: ResultsPaginationProps) {
  const { page, pageSize } = filters;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const hrefFor = (target: number) => salesPageHref({ ...filters, page: target }, mode);

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing {formatCount(from)}–{formatCount(to)} of {formatCount(total)}{" "}
        {total === 1 ? noun[0] : noun[1]}
      </p>
      {lastPage > 1 && (
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PageStep href={page > 1 ? hrefFor(page - 1) : null} label="Previous">
                <ChevronLeftIcon data-icon="inline-start" />
                <span className="hidden sm:block">Previous</span>
              </PageStep>
            </PaginationItem>
            {pageList(page, lastPage).map((item, i) =>
              item === "gap" ? (
                <PaginationItem key={`gap-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <Link
                    href={hrefFor(item)}
                    aria-current={item === page ? "page" : undefined}
                    className={buttonVariants({
                      variant: item === page ? "outline" : "ghost",
                      size: "icon",
                    })}
                  >
                    {formatCount(item)}
                  </Link>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PageStep href={page < lastPage ? hrefFor(page + 1) : null} label="Next">
                <span className="hidden sm:block">Next</span>
                <ChevronRightIcon data-icon="inline-end" />
              </PageStep>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

function PageStep({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const className = buttonVariants({ variant: "ghost" });
  if (!href) {
    return (
      <span aria-disabled className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={`${label} page`} className={className}>
      {children}
    </Link>
  );
}

/** Page numbers around the current page, with "gap" where pages are skipped: 1 … 4 5 6 … 20 */
function pageList(current: number, last: number): (number | "gap")[] {
  const pages = [...new Set([1, current - 1, current, current + 1, last])]
    .filter((p) => p >= 1 && p <= last)
    .sort((a, b) => a - b);
  const list: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) list.push("gap");
    list.push(p);
  });
  return list;
}
