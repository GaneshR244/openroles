"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useTransition,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";
import { salesPageHref, type Mode, type PageState } from "@/lib/filters";
import type { JobFilters } from "@/lib/types";

export type FilterChange = Partial<
  Pick<JobFilters, "view" | "country" | "source" | "q">
> & { mode?: Mode };

type FilterNavigation = PageState & {
  /** Applies the change, resets to page 1 and updates the URL with router.replace. */
  navigate: (change: FilterChange) => void;
  /** True while the server renders the new results. */
  isPending: boolean;
};

const FilterNavigationContext = createContext<FilterNavigation | null>(null);

/**
 * Shares the current filters (parsed on the server) with the client controls.
 * Controls show the new value at once (optimistic) while the results load.
 */
export function FilterNavigationProvider({
  filters,
  mode,
  children,
}: PageState & { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic<PageState>({ filters, mode });

  const navigate = useCallback(
    (change: FilterChange) => {
      const { mode: nextMode = current.mode, ...filterChanges } = change;
      const next: PageState = {
        filters: { ...current.filters, ...filterChanges, page: 1 },
        mode: nextMode,
      };
      startTransition(() => {
        setCurrent(next);
        router.replace(salesPageHref(next.filters, next.mode), { scroll: false });
      });
    },
    [current, router, setCurrent],
  );

  const value = useMemo(
    () => ({ ...current, navigate, isPending }),
    [current, navigate, isPending],
  );
  return <FilterNavigationContext value={value}>{children}</FilterNavigationContext>;
}

export function useFilterNavigation(): FilterNavigation {
  const value = useContext(FilterNavigationContext);
  if (!value) throw new Error("useFilterNavigation must be used inside FilterNavigationProvider");
  return value;
}

/** Fades its children while new results load. */
export function PendingArea({ children }: { children: ReactNode }) {
  const { isPending } = useFilterNavigation();
  return (
    <div
      aria-busy={isPending}
      className={cn("flex flex-col gap-4 transition-opacity", isPending && "opacity-60")}
    >
      {children}
    </div>
  );
}
