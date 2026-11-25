// Date and number formatting. Every time is shown in IST (Asia/Kolkata).
const TIME_ZONE = "Asia/Kolkata";
// India has no daylight saving time, so IST is always UTC+05:30.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const fullDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const timeOnly = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayMonth = new Intl.DateTimeFormat("en-IN", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
});
const relative = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto", style: "short" });
const count = new Intl.NumberFormat("en-IN");

/** Midnight IST of the day that contains `time`, as epoch milliseconds. */
export function startOfDayIST(time: number): number {
  return Math.floor((time + IST_OFFSET_MS) / DAY) * DAY - IST_OFFSET_MS;
}

/** "25 Nov 2026, 06:14 IST" */
export function formatDateTimeIST(iso: string): string {
  return `${fullDateTime.format(new Date(iso))} IST`;
}

/** "today 06:14 IST", "yesterday 06:14 IST" or "23 Nov, 06:14 IST" */
export function formatRunTime(iso: string, now: number): string {
  const time = Date.parse(iso);
  const days = calendarDaysBetween(time, now);
  const day = days === 0 ? "today" : days === 1 ? "yesterday" : `${dayMonth.format(time)},`;
  return `${day} ${timeOnly.format(time)} IST`;
}

/** "just now", "5 min ago", "2 hr ago", "yesterday", "3 days ago" */
export function formatRelative(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "–";
  const elapsed = now - time;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  const days = Math.max(1, calendarDaysBetween(time, now));
  if (days < 30) return relative.format(-days, "day");
  return relative.format(-Math.floor(days / 30), "month");
}

/** Indian digit grouping: 1,23,456 */
export function formatCount(n: number): string {
  return count.format(n);
}

/** "1 role", "3 roles" */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

function calendarDaysBetween(earlier: number, later: number): number {
  return Math.round((startOfDayIST(later) - startOfDayIST(earlier)) / DAY);
}
