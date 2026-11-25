/**
 * Runs `work` over `items` with at most `size` in flight. Workers stop taking new items once
 * `shouldStop()` returns true (e.g. the run deadline); items already started finish.
 * Errors thrown by `work` are the caller's job to catch: wrap each item in try/catch.
 * Returns how many items were started.
 */
export async function runPool<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<number> {
  let next = 0;
  let started = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++]!;
      started++;
      await work(item);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, worker);
  await Promise.all(workers);
  return started;
}
