import { cn } from "@/lib/utils";
import { badgeVariants } from "@/components/ui/badge";
import { WORK_MODE_LABELS } from "@/lib/labels";
import type { WorkMode } from "@/lib/types";

const DOT_COLORS: Record<WorkMode, string> = {
  ONSITE: "bg-amber-500",
  HYBRID: "bg-sky-500",
  REMOTE: "bg-emerald-500",
  UNKNOWN: "bg-muted-foreground/40",
};

// A plain <span> with the shadcn badge styles, so it renders in Server Components.
export function WorkModeBadge({ workMode }: { workMode: WorkMode }) {
  return (
    <span
      className={cn(
        badgeVariants({ variant: "outline" }),
        "font-normal",
        workMode === "UNKNOWN" && "text-muted-foreground",
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT_COLORS[workMode])} />
      {WORK_MODE_LABELS[workMode]}
    </span>
  );
}
