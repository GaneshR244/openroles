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
  backoffDelay,
  HttpClient,
  MAX_RESPONSE_BYTES,
  parseRetryAfter,
  type FetchFn,
} from './http-client.js';
import { BROWSER_USER_AGENT, OPENROLES_USER_AGENT } from './host-policies.js';

const API = 'https://api.example.com/jobs'; // default policy: concurrency 2, gap 200 ms
const LEVER = 'https://api.lever.co/v0/postings/acme?mode=json'; // gap 100 ms
const LINKEDIN = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response('error', { status: code, headers });
}

/** A client whose clock only moves when it sleeps (or when a test calls advance). */
function setup() {
  let clock = 0;
  const deps = {
    fetch: vi.fn<FetchFn>(),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    random: vi.fn(() => 0.5),
    now: vi.fn(() => clock),
  };
  return {
    client: new HttpClient(deps),
    deps,
    advance: (ms: number) => (clock += ms),
  };
}

describe('backoffDelay', () => {
  it('stays between 0 and min(cap, base * 2^attempt)', () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ceiling = Math.min(30_000, 1_000 * 2 ** attempt);
      expect(backoffDelay(attempt, 1_000, 30_000, () => 0)).toBe(0);
      expect(backoffDelay(attempt, 1_000, 30_000, () => 0.999)).toBeLessThan(ceiling);
      expect(backoffDelay(attempt, 1_000, 30_000, () => 1)).toBe(ceiling);
    }
  });

  it('uses the full window (full jitter)', () => {
    expect(backoffDelay(0, 1_000, 30_000, () => 0.5)).toBe(500);
    expect(backoffDelay(2, 1_000, 30_000, () => 0.5)).toBe(2_000);
    expect(backoffDelay(10, 1_000, 30_000, () => 0.5)).toBe(15_000);
    expect(backoffDelay(3, 30_000, 120_000, () => 1)).toBe(120_000);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('7', 0)).toBe(7_000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfter(new Date(1_000).toUTCString(), 5_000)).toBe(0);
  });

  it('ignores missing or invalid values', () => {
    expect(parseRetryAfter(null, 0)).toBeUndefined();
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
  });
});

describe('HttpClient', () => {
  it('returns parsed JSON and sends the host user agent', async () => {
    const { client, deps } = setup();
    deps.fetch.mockResolvedValueOnce(json({ ok: true }));

    await expect(client.getJson(API)).resolves.toEqual({ ok: true });
    const init = deps.fetch.mock.calls[0][1];
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ 'user-agent': OPENROLES_USER_AGENT });
  });

  it('posts a JSON body', async () => {
    const { client, deps } = setup();
    deps.fetch.mockResolvedValueOnce(json({ results: [] }));

    await client.postJson(API, { query: '' });
    const init = deps.fetch.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"query":""}');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('returns text and uses a browser user agent for LinkedIn', async () => {
    const { client, deps } = setup();
    deps.fetch.mockResolvedValueOnce(new Response('<li>card</li>', { status: 200 }));

    await expect(client.getText(LINKEDIN)).resolves.toBe('<li>card</li>');
    expect(deps.fetch.mock.calls[0][1].headers).toMatchObject({ 'user-agent': BROWSER_USER_AGENT });
  });

  describe('retry', () => {
    it('retries a 503 with full-jitter backoff, then succeeds', async () => {
      const { client, deps } = setup();
      deps.fetch.mockResolvedValueOnce(status(503)).mockResolvedValueOnce(json({ ok: 1 }));

      await expect(client.getJson(API)).resolves.toEqual({ ok: 1 });
      expect(deps.fetch).toHaveBeenCalledTimes(2);
      expect(deps.sleep.mock.calls).toEqual([[500]]); // 0.5 * min(30 s, 1 s * 2^0)
    });

    it('gives up after maxAttempts with a ServerError', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(502));

      const error = await client.getJson(API).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServerError);
      expect((error as ServerError).status).toBe(502);
      expect(deps.fetch).toHaveBeenCalledTimes(3);
    });

    it('honors Retry-After in seconds', async () => {
      const { client, deps } = setup();
      deps.fetch
        .mockResolvedValueOnce(status(429, { 'retry-after': '7' }))
        .mockResolvedValueOnce(json({ ok: 1 }));

      await client.getJson(API);
      expect(deps.sleep.mock.calls).toEqual([[7_000]]);
    });

    it('honors Retry-After as an HTTP date', async () => {
      const { client, deps } = setup();
      deps.fetch
        .mockResolvedValueOnce(status(503, { 'retry-after': new Date(3_000).toUTCString() }))
        .mockResolvedValueOnce(json({ ok: 1 }));

      await client.getJson(API);
      expect(deps.sleep.mock.calls).toEqual([[3_000]]);
    });

    it('does not wait out a Retry-After longer than the backoff cap', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(429, { 'retry-after': '3600' }));

      const error = await client.getJson(API).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RateLimitedError);
      expect((error as RateLimitedError).retryAfterMs).toBe(3_600_000);
      expect(deps.fetch).toHaveBeenCalledTimes(1);
      expect(deps.sleep).not.toHaveBeenCalled();
    });

    it('gives up on a 503 with a long Retry-After without blocking the host', async () => {
      const { client, deps } = setup();
      deps.fetch
        .mockResolvedValueOnce(status(503, { 'retry-after': '3600' }))
        .mockResolvedValueOnce(json({ ok: 1 }));

      await expect(client.getJson(API)).rejects.toBeInstanceOf(ServerError);
      expect(client.isBlocked('api.example.com')).toBe(false);
      await expect(client.getJson(API)).resolves.toEqual({ ok: 1 });
    });

    it('retries network errors, then throws NetworkError', async () => {
      const { client, deps } = setup();
      deps.fetch.mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.getJson(API, { maxAttempts: 2 })).rejects.toBeInstanceOf(NetworkError);
      expect(deps.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundError on 404 without retrying', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(404));

      const error = await client.getJson(API).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toMatchObject({ code: 'not_found', status: 404, url: API });
      expect(deps.fetch).toHaveBeenCalledTimes(1);
      expect(deps.sleep).not.toHaveBeenCalled();
    });

    it('throws a plain HttpError on other 4xx without retrying', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(403));

      const error = await client.getJson(API).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ code: 'http_error', status: 403 });
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('turns an aborted request into TimeoutError and retries it', async () => {
    const { client, deps } = setup();
    deps.fetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

    const error = await client.getJson(API, { timeoutMs: 5, maxAttempts: 2 }).catch((e) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toMatchObject({ code: 'timeout' });
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-JSON response from getJson with not_json', async () => {
    const { client, deps } = setup();
    deps.fetch.mockResolvedValueOnce(
      new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );

    const error = await client.getJson(API).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ code: 'not_json', status: 200 });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
  });

  describe('size cap', () => {
    it('rejects a declared content-length over 20 MB', async () => {
      const { client, deps } = setup();
      deps.fetch.mockResolvedValueOnce(
        json({}, 200, { 'content-length': String(MAX_RESPONSE_BYTES + 1) }),
      );

      await expect(client.getJson(API)).rejects.toBeInstanceOf(ResponseTooLargeError);
    });

    it('stops reading a streamed body once it passes 20 MB', async () => {
      const { client, deps } = setup();
      deps.fetch.mockResolvedValueOnce(new Response(new Uint8Array(MAX_RESPONSE_BYTES + 1)));

      await expect(client.getText(API)).rejects.toBeInstanceOf(ResponseTooLargeError);
      expect(deps.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker', () => {
    it('opens after 3 calls in a row end in 429, then blocks without fetching', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(429));

      for (let call = 0; call < 3; call++) {
        await expect(client.getText(LINKEDIN)).rejects.toBeInstanceOf(RateLimitedError);
      }
      expect(deps.fetch).toHaveBeenCalledTimes(9); // 3 calls x 3 attempts
      expect(client.isBlocked('www.linkedin.com')).toBe(true);

      await expect(client.getText(LINKEDIN)).rejects.toBeInstanceOf(BlockedError);
      expect(deps.fetch).toHaveBeenCalledTimes(9);
    });

    it('uses the LinkedIn backoff (base 30 s)', async () => {
      const { client, deps } = setup();
      deps.fetch.mockResolvedValueOnce(status(429)).mockResolvedValueOnce(new Response('ok'));

      await client.getText(LINKEDIN);
      expect(deps.sleep).toHaveBeenCalledWith(15_000); // 0.5 * min(120 s, 30 s * 2^0)
    });

    it('resets the count after a successful call', async () => {
      const { client, deps } = setup();
      const outcomes = [429, 429, 429, 429, 429, 429, 200, 429, 429, 429, 429, 429, 429];
      deps.fetch.mockImplementation(async () =>
        outcomes.shift() === 200 ? new Response('ok') : status(429),
      );

      const opts = { maxAttempts: 3 };
      await expect(client.getText(LINKEDIN, opts)).rejects.toBeInstanceOf(RateLimitedError);
      await expect(client.getText(LINKEDIN, opts)).rejects.toBeInstanceOf(RateLimitedError);
      await expect(client.getText(LINKEDIN, opts)).resolves.toBe('ok');
      await expect(client.getText(LINKEDIN, opts)).rejects.toBeInstanceOf(RateLimitedError);
      await expect(client.getText(LINKEDIN, opts)).rejects.toBeInstanceOf(RateLimitedError);
      expect(client.isBlocked('www.linkedin.com')).toBe(false);
    });

    it('opens for ATS hosts too', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(429));
      const greenhouse = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';

      for (let call = 0; call < 3; call++) {
        await expect(client.getJson(greenhouse, { maxAttempts: 1 })).rejects.toBeInstanceOf(
          RateLimitedError,
        );
      }
      expect(client.isBlocked('boards-api.greenhouse.io')).toBe(true);
      await expect(client.getJson(greenhouse)).rejects.toBeInstanceOf(BlockedError);
      expect(deps.fetch).toHaveBeenCalledTimes(3);
    });

    it('blocks any host at once on a 429 with Retry-After longer than its cap', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(429, { 'retry-after': '86081' }));

      // api.example.com has no breaker flag; a long Retry-After still blocks it.
      await expect(client.getJson(API)).rejects.toBeInstanceOf(RateLimitedError);
      expect(client.isBlocked('api.example.com')).toBe(true);
      await expect(client.getJson(`${API}?page=2`)).rejects.toBeInstanceOf(BlockedError);
      expect(deps.fetch).toHaveBeenCalledTimes(1);

      // Other hosts are not affected.
      deps.fetch.mockImplementation(async () => json({ ok: 1 }));
      await expect(client.getJson(LEVER)).resolves.toEqual({ ok: 1 });
    });

    it('treats a LinkedIn Retry-After within its 120 s cap as a normal retry', async () => {
      const { client, deps } = setup();
      deps.fetch
        .mockResolvedValueOnce(status(429, { 'retry-after': '90' }))
        .mockResolvedValueOnce(new Response('ok'));

      await expect(client.getText(LINKEDIN)).resolves.toBe('ok');
      expect(deps.sleep).toHaveBeenCalledWith(90_000);
      expect(client.isBlocked('www.linkedin.com')).toBe(false);
    });

    it('never opens for hosts without a breaker', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => status(429));

      for (let call = 0; call < 4; call++) {
        await expect(client.getJson(API, { maxAttempts: 1 })).rejects.toBeInstanceOf(
          RateLimitedError,
        );
      }
      expect(client.isBlocked('api.example.com')).toBe(false);
      expect(deps.fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('per-host limiter', () => {
    it('keeps the minimum gap between request starts', async () => {
      const { client, deps, advance } = setup();
      deps.fetch.mockImplementation(async () => json({}));

      await client.getJson(LEVER); // starts at 0
      await client.getJson(LEVER); // waits until 100
      advance(30); // now 130; next slot is 200
      await client.getJson(LEVER);
      expect(deps.sleep.mock.calls).toEqual([[100], [70]]);
    });

    it('spaces out concurrent requests', async () => {
      const { client, deps } = setup();
      deps.sleep.mockImplementation(async () => undefined); // the clock stays at 0
      deps.fetch.mockImplementation(async () => json({}));

      await Promise.all([client.getJson(LEVER), client.getJson(LEVER), client.getJson(LEVER)]);
      expect(deps.sleep.mock.calls).toEqual([[100], [200]]); // starts at 0, 100 and 200
    });

    it('adds random jitter to the LinkedIn gap (2-5 s)', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => new Response('ok'));

      await client.getText(LINKEDIN);
      await client.getText(LINKEDIN);
      expect(deps.sleep.mock.calls).toEqual([[3_500]]); // 2,000 + 0.5 * 3,000
    });

    it('keeps Workable to one slow lane (1.5-2.5 s gap)', async () => {
      const { client, deps } = setup();
      deps.fetch.mockImplementation(async () => json({ results: [] }));
      const workable = 'https://apply.workable.com/api/v3/accounts/acme/jobs';

      await client.postJson(workable, {});
      await client.postJson(workable, {});
      expect(deps.sleep.mock.calls).toEqual([[2_000]]); // 1,500 + 0.5 * 1,000
    });

    it('limits concurrency per host', async () => {
      const { client, deps } = setup();
      let finishFirst: (r: Response) => void = () => undefined;
      deps.fetch
        .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
        .mockImplementation(async () => json([]));

      const yc = 'https://yc-oss.github.io/api/companies/all.json'; // concurrency 1
      const first = client.getJson(yc);
      const second = client.getJson(yc);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(deps.fetch).toHaveBeenCalledTimes(1);

      finishFirst(json([]));
      await Promise.all([first, second]);
      expect(deps.fetch).toHaveBeenCalledTimes(2);
    });
  });
});
