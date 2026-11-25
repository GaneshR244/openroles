import { catchUpDue } from './daily-fetch.scheduler.js';

// 06:00 IST on 25 Nov 2026 is 00:30 UTC.
const at = (iso: string) => new Date(iso);

describe('catchUpDue', () => {
  it('waits when it is still before 06:00 IST', () => {
    expect(catchUpDue(at('2026-11-25T00:29:00Z'), null)).toBe(false);
  });

  it('runs after 06:00 IST when there has never been a good run', () => {
    expect(catchUpDue(at('2026-11-25T01:00:00Z'), null)).toBe(true);
  });

  it('skips when a good run already started at or after 06:00 IST today', () => {
    expect(catchUpDue(at('2026-11-25T09:00:00Z'), at('2026-11-25T00:30:00Z'))).toBe(false);
    expect(catchUpDue(at('2026-11-25T09:00:00Z'), at('2026-11-25T08:00:00Z'))).toBe(false);
  });

  it("runs when the last good run was yesterday or before today's 06:00 IST", () => {
    expect(catchUpDue(at('2026-11-25T09:00:00Z'), at('2026-11-24T00:30:00Z'))).toBe(true);
    // 04:30 IST on the 25th: a manual run before the morning slot doesn't count.
    expect(catchUpDue(at('2026-11-25T09:00:00Z'), at('2026-11-24T23:00:00Z'))).toBe(true);
  });

  it('uses the India calendar day, not the UTC one', () => {
    // 19:00 UTC on the 25th is 00:30 IST on the 26th: before that day's 06:00 slot.
    expect(catchUpDue(at('2026-11-25T19:00:00Z'), at('2026-11-25T00:30:00Z'))).toBe(false);
    // 01:00 UTC on the 26th is 06:30 IST on the 26th: the 25th's run no longer counts.
    expect(catchUpDue(at('2026-11-26T01:00:00Z'), at('2026-11-25T00:30:00Z'))).toBe(true);
  });
});
