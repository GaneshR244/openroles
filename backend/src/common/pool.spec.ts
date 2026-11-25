import { runPool } from './pool.js';

describe('runPool', () => {
  it('processes every item with at most `size` in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      inFlight--;
    });
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('stops taking new items once shouldStop is true', async () => {
    const seen: number[] = [];
    const started = await runPool(
      [1, 2, 3, 4, 5],
      1,
      async (n) => {
        seen.push(n);
      },
      () => seen.length >= 2,
    );
    expect(started).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it('handles an empty list', async () => {
    expect(await runPool([], 5, async () => {})).toBe(0);
  });
});
