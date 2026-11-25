import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTimeIST, formatRelative } from "@/lib/format";

/** "2 hr ago", with the full IST date in a tooltip. Text is computed on the server. */
export function RelativeTime({ iso, now }: { iso: string; now: number }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<time dateTime={iso} />}
        className="cursor-default underline decoration-muted-foreground/40 decoration-dotted underline-offset-4"
      >
        {formatRelative(iso, now)}
      </TooltipTrigger>
      <TooltipContent>{formatDateTimeIST(iso)}</TooltipContent>
    </Tooltip>
  );
}
