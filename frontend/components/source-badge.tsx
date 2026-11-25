import { cn } from "@/lib/utils";
import { badgeVariants } from "@/components/ui/badge";
import { SOURCE_LABELS } from "@/lib/labels";
import type { JobSource } from "@/lib/types";

const SOURCE_COLORS: Record<JobSource, string> = {
  LINKEDIN: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  GREENHOUSE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  LEVER: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
  ASHBY: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  SMARTRECRUITERS: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  WORKABLE: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

// A plain <span> with the shadcn badge styles, so it renders in Server Components.
export function SourceBadge({ source }: { source: JobSource }) {
  return (
    <span className={cn(badgeVariants({ variant: "secondary" }), SOURCE_COLORS[source])}>
      {SOURCE_LABELS[source]}
    </span>
  );
}
