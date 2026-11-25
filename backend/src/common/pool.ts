/**
 * Runs `work` over `items` with at most `size` in flight. Workers stop taking new items once
 * `shouldStop()` returns true (e.g. the run deadline); items already started finish.
 * An error from one item never stops the others: it goes to `onError` (default: rethrown at the
 * end, after every started item has finished). Returns how many items were started.
 */
export async function runPool<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
  onError?: (item: T, err: unknown) => void,
): Promise<number> {
  let next = 0;
  let started = 0;
  let firstError: unknown;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++]!;
      started++;
      try {
        await work(item);
      } catch (err) {
        if (onError) onError(item, err);
        else if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, worker);
  await Promise.all(workers);
  if (failed) throw firstError;
  return started;
}
