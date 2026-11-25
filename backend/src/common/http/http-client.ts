import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BlockedError,
  HttpError,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  ResponseTooLargeError,
  ServerError,
  TimeoutError,
} from './errors.js';
import {
  DEFAULT_RETRY_BASE_MS,
  DEFAULT_RETRY_CAP_MS,
  policyFor,
  type HostPolicy,
} from './host-policies.js';

// The only way the app talks to the outside world (docs/ARCHITECTURE.md §3.4):
// timeout, size cap, per-host limiter, retry with full-jitter backoff, circuit breaker.

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Everything with side effects, so tests can control time and the network. */
export type HttpDeps = {
  fetch: FetchFn;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => number;
};

export const HTTP_DEPS = Symbol('HTTP_DEPS');

export type RequestOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  headers?: Record<string, string>;
};

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
/** Calls that end in 429 (after retries) in a row before a breaker host is blocked. */
export const BREAKER_THRESHOLD = 3;

const DEFAULT_DEPS: HttpDeps = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  now: () => Date.now(),
};

type HostState = {
  active: number;
  waiting: Array<() => void>;
  nextStartAt: number;
  consecutiveRateLimits: number;
  open: boolean;
};

type Fetched = { status: number; headers: Headers; body: string };

type SendInit = { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string };

/** Full-jitter backoff: random(0, min(cap, base * 2^attempt)). `attempt` starts at 0. */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number,
): number {
  return random() * Math.min(capMs, baseMs * 2 ** attempt);
}

/** Retry-After in ms, from delta-seconds or an HTTP date. undefined when absent or invalid. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const date = Date.parse(text);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

@Injectable()
export class HttpClient {
  private readonly deps: HttpDeps;
  private readonly hosts = new Map<string, HostState>();

  constructor(@Optional() @Inject(HTTP_DEPS) deps?: Partial<HttpDeps>) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  async getJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
    const init: SendInit = { method: 'GET', headers: { accept: 'application/json' } };
    return parseJson<T>(url, await this.request(url, init, opts));
  }

  async postJson<T = unknown>(url: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
    const init: SendInit = {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
    return parseJson<T>(url, await this.request(url, init, opts));
  }

  async getText(url: string, opts: RequestOptions = {}): Promise<string> {
    const res = await this.request(url, { method: 'GET', headers: {} }, opts);
    return res.body;
  }

  /** true once the host's circuit breaker has opened (it stays open for this client's life). */
  isBlocked(hostname: string): boolean {
    return this.hosts.get(hostname)?.open ?? false;
  }

  private async request(url: string, init: SendInit, opts: RequestOptions): Promise<Fetched> {
    const hostname = new URL(url).hostname;
    const policy = policyFor(hostname);
    const state = this.stateFor(hostname);
    if (state.open) throw new BlockedError(url);

    const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const headers = { 'user-agent': policy.userAgent, ...init.headers, ...opts.headers };

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.sendLimited(url, { ...init, headers }, timeoutMs, policy, state);
        this.recordOutcome(state, policy);
        return res;
      } catch (error) {
        const delay =
          attempt + 1 < maxAttempts ? this.retryDelay(error, attempt, policy) : undefined;
        if (delay === undefined) {
          this.recordOutcome(state, policy, error);
          throw error;
        }
        await this.deps.sleep(delay);
      }
    }
  }

  /** Waits for a free slot and the host's minimum gap, then sends. */
  private async sendLimited(
    url: string,
    init: SendInit,
    timeoutMs: number,
    policy: HostPolicy,
    state: HostState,
  ): Promise<Fetched> {
    await this.acquire(state, policy);
    try {
      if (state.open) throw new BlockedError(url);
      await this.waitForGap(state, policy);
      return await this.send(url, init, timeoutMs);
    } finally {
      this.release(state);
    }
  }

  private async send(url: string, init: SendInit, timeoutMs: number): Promise<Fetched> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.deps.fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw this.statusError(url, response);
      }
      const body = await readBody(url, response);
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (controller.signal.aborted) throw new TimeoutError(url, timeoutMs);
      throw new NetworkError(url, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private statusError(url: string, response: Response): HttpError {
    const { status } = response;
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.deps.now());
    if (status === 404) return new NotFoundError(url);
    if (status === 429) return new RateLimitedError(url, retryAfterMs);
    if (status >= 500) return new ServerError(url, status, retryAfterMs);
    return new HttpError('http_error', url, `HTTP ${status}: ${url}`, status);
  }

  /** ms to wait before the next attempt, or undefined when the error must not be retried. */
  private retryDelay(error: unknown, attempt: number, policy: HostPolicy): number | undefined {
    const retryable =
      error instanceof NetworkError ||
      error instanceof TimeoutError ||
      error instanceof RateLimitedError ||
      error instanceof ServerError;
    if (!retryable) return undefined;

    const capMs = policy.retryCapMs ?? DEFAULT_RETRY_CAP_MS;
    const retryAfterMs =
      error instanceof RateLimitedError || error instanceof ServerError
        ? error.retryAfterMs
        : undefined;
    if (retryAfterMs !== undefined) {
      // The server asked for a longer pause than we wait in a run: give up instead of hammering.
      return retryAfterMs <= capMs ? retryAfterMs : undefined;
    }
    return backoffDelay(
      attempt,
      policy.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
      capMs,
      this.deps.random,
    );
  }

  /**
   * Circuit breaker. The host is blocked for the life of the client when:
   * - it answers 429 with a Retry-After longer than its retry cap (any host), or
   * - 3 calls in a row end in 429 after retries (hosts with `breaker`).
   * Any other answer resets the count.
   */
  private recordOutcome(state: HostState, policy: HostPolicy, error?: unknown): void {
    if (error instanceof RateLimitedError) {
      state.consecutiveRateLimits++;
      const capMs = policy.retryCapMs ?? DEFAULT_RETRY_CAP_MS;
      const longPause = error.retryAfterMs !== undefined && error.retryAfterMs > capMs;
      const tooMany = policy.breaker && state.consecutiveRateLimits >= BREAKER_THRESHOLD;
      if (longPause || tooMany) state.open = true;
    } else if (!(error instanceof BlockedError)) {
      state.consecutiveRateLimits = 0;
    }
  }

  private async acquire(state: HostState, policy: HostPolicy): Promise<void> {
    if (state.active < policy.concurrency) {
      state.active++;
      return;
    }
    // release() hands its slot straight to us, so `active` stays the same.
    await new Promise<void>((resolve) => state.waiting.push(resolve));
  }

  private release(state: HostState): void {
    const next = state.waiting.shift();
    if (next) next();
    else state.active--;
  }

  /** Reserves the next start time synchronously, so concurrent requests stay spaced out. */
  private async waitForGap(state: HostState, policy: HostPolicy): Promise<void> {
    const now = this.deps.now();
    const startAt = Math.max(now, state.nextStartAt);
    const jitter = policy.jitterMs ? this.deps.random() * policy.jitterMs : 0;
    state.nextStartAt = startAt + policy.minGapMs + jitter;
    if (startAt > now) await this.deps.sleep(startAt - now);
  }

  private stateFor(hostname: string): HostState {
    let state = this.hosts.get(hostname);
    if (!state) {
      state = { active: 0, waiting: [], nextStartAt: 0, consecutiveRateLimits: 0, open: false };
      this.hosts.set(hostname, state);
    }
    return state;
  }
}

/** Reads the body as text, stopping as soon as it passes MAX_RESPONSE_BYTES. */
async function readBody(url: string, response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(url, MAX_RESPONSE_BYTES);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(url, MAX_RESPONSE_BYTES);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson<T>(url: string, res: Fetched): T {
  const type = res.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('json')) {
    const got = type || 'no content type';
    throw new HttpError('not_json', url, `Expected JSON, got ${got}: ${url}`, res.status);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new HttpError('not_json', url, `Body is not valid JSON: ${url}`, res.status);
  }
}
