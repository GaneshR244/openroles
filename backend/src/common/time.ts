/** India Standard Time is a fixed UTC+05:30. It has no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC instant of midnight in India on the IST calendar day that contains `d`. */
export function startOfIstDay(d: Date): Date {
  const istMs = d.getTime() + IST_OFFSET_MS;
  const istMidnightMs = Math.floor(istMs / DAY_MS) * DAY_MS;
  return new Date(istMidnightMs - IST_OFFSET_MS);
}

/** `d` moved by `n` whole days (negative goes back). Safe because UTC and IST have no DST. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** The instant exactly `n` days before `now`. */
export function daysBefore(now: Date, n: number): Date {
  return addDays(now, -n);
}
