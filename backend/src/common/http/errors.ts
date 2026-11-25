// Typed HTTP errors (docs/ARCHITECTURE.md §3.15). `code` is short and stable: board errors
// are stored as { ats, slug, code } in run stats.

export class HttpError extends Error {
  constructor(
    readonly code: string,
    readonly url: string,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** 404. Never retried. For a board, it usually means the slug is wrong or the board is gone. */
export class NotFoundError extends HttpError {
  constructor(url: string) {
    super('not_found', url, `Not found (404): ${url}`, 404);
  }
}

/** 429 after every retry. `retryAfterMs` is the server's Retry-After, when it sent one. */
export class RateLimitedError extends HttpError {
  constructor(
    url: string,
    readonly retryAfterMs?: number,
  ) {
    super('rate_limited', url, `Rate limited (429): ${url}`, 429);
  }
}

export class TimeoutError extends HttpError {
  constructor(url: string, timeoutMs?: number) {
    const after = timeoutMs === undefined ? '' : ` after ${timeoutMs} ms`;
    super('timeout', url, `Timed out${after}: ${url}`);
  }
}

/** DNS, connection reset, TLS and other failures before a response arrived. */
export class NetworkError extends HttpError {
  constructor(url: string, cause?: unknown) {
    const reason = cause instanceof Error ? `: ${cause.message}` : '';
    super('network', url, `Network error${reason} (${url})`, undefined, { cause });
  }
}

/** 5xx after every retry. */
export class ServerError extends HttpError {
  constructor(
    url: string,
    status = 500,
    readonly retryAfterMs?: number,
  ) {
    super('server_error', url, `Server error (${status}): ${url}`, status);
  }
}

/** The response did not match its zod schema: the source changed its format. */
export class SchemaChangedError extends HttpError {
  constructor(
    url: string,
    readonly reason: string,
  ) {
    super('schema_changed', url, `Response format changed (${reason}): ${url}`);
  }
}

/** The host's circuit breaker is open, so the request was not sent. */
export class BlockedError extends HttpError {
  constructor(url: string) {
    super('blocked', url, `Host is blocked for this run (circuit open): ${url}`);
  }
}

export class ResponseTooLargeError extends HttpError {
  constructor(url: string, maxBytes: number) {
    super('too_large', url, `Response larger than ${maxBytes} bytes: ${url}`);
  }
}

/**
 * true for errors about the host, not the board: it is rate limiting us or its breaker is open.
 * They are temporary, so a board that fails this way is not broken.
 */
export function isHostBlockedError(error: unknown): error is RateLimitedError | BlockedError {
  return error instanceof RateLimitedError || error instanceof BlockedError;
}
