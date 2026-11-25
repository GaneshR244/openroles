import { addDays, daysBefore, startOfIstDay } from './time.js';

describe('startOfIstDay', () => {
  it.each([
    // 20:00 UTC is 01:30 IST the next day, so the IST day began at 18:30 UTC the same day.
    ['2026-11-25T20:00:00Z', '2026-11-25T18:30:00.000Z'],
    // 10:00 UTC is 15:30 IST on the same day, which began at 18:30 UTC the day before.
    ['2026-11-25T10:00:00Z', '2026-11-24T18:30:00.000Z'],
    // Exactly IST midnight stays put.
    ['2026-11-25T18:30:00Z', '2026-11-25T18:30:00.000Z'],
    // One millisecond before IST midnight is still the previous IST day.
    ['2026-11-25T18:29:59.999Z', '2026-11-24T18:30:00.000Z'],
    // Year boundary.
    ['2026-12-31T19:00:00Z', '2026-12-31T18:30:00.000Z'],
  ])('%s -> %s', (input, expected) => {
    expect(startOfIstDay(new Date(input)).toISOString()).toBe(expected);
  });
});

describe('addDays and daysBefore', () => {
  const now = new Date('2026-11-25T20:00:00Z');

  it('adds whole days', () => {
    expect(addDays(now, 1).toISOString()).toBe('2026-11-26T20:00:00.000Z');
    expect(addDays(now, -2).toISOString()).toBe('2026-11-23T20:00:00.000Z');
    expect(addDays(now, 0).getTime()).toBe(now.getTime());
  });

  it('goes back n days', () => {
    expect(daysBefore(now, 30).toISOString()).toBe('2026-10-26T20:00:00.000Z');
  });

  it('does not change its input', () => {
    addDays(now, 5);
    expect(now.toISOString()).toBe('2026-11-25T20:00:00.000Z');
  });
});
