import type { RequestOptions } from '../../common/http/http-client.js';
import type { ReadOptions } from './source.types.js';

// Small helpers shared by the board readers.

/** A Date from an ISO string or epoch ms, or undefined when missing or unparseable. */
export function toDate(value: string | number | null | undefined): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Non-empty trimmed strings only, each kept once, in order. */
export function compact(values: Array<string | null | undefined>): string[] {
  const kept = values.map((v) => v?.trim()).filter((v): v is string => !!v);
  return [...new Set(kept)];
}

/** "City, Region, Country" from whichever parts are present. */
export function joinParts(...parts: Array<string | null | undefined>): string {
  return compact(parts).join(', ');
}

/** The part of ReadOptions that HttpClient understands. */
export function requestOptions(opts: ReadOptions): RequestOptions {
  return { timeoutMs: opts.timeoutMs, maxAttempts: opts.maxAttempts };
}
