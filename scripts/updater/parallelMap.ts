export async function parallelMap<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  options: Readonly<{ concurrency?: number }> = {},
): Promise<R[]> {
  if (items.length === 0) return [];

  const concurrencyLimit = options.concurrency ?? items.length;
  if (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1) {
    throw new Error(`parallelMap: invalid concurrency: ${String(concurrencyLimit)}`);
  }

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workerCount = Math.min(concurrencyLimit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) break;
      const item = items[index];
      if (item === undefined) {
        throw new Error(`parallelMap: missing item at index ${String(index)}`);
      }
      results[index] = await mapper(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}
