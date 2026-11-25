import {
  BlockedError,
  HttpError,
  isHostBlockedError,
  NotFoundError,
  RateLimitedError,
  SchemaChangedError,
  ServerError,
  TimeoutError,
} from './errors.js';

const URL_X = 'https://api.example.com/x';

describe('HTTP errors', () => {
  it('carry a stable code, the url and the status', () => {
    const error = new NotFoundError(URL_X);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      name: 'NotFoundError',
      code: 'not_found',
      url: URL_X,
      status: 404,
    });
    expect(new SchemaChangedError(URL_X, 'jobs: required')).toMatchObject({
      code: 'schema_changed',
      reason: 'jobs: required',
    });
  });

  it('isHostBlockedError is true only for rate limiting and an open breaker', () => {
    expect(isHostBlockedError(new RateLimitedError(URL_X))).toBe(true);
    expect(isHostBlockedError(new BlockedError(URL_X))).toBe(true);
    expect(isHostBlockedError(new NotFoundError(URL_X))).toBe(false);
    expect(isHostBlockedError(new ServerError(URL_X, 503))).toBe(false);
    expect(isHostBlockedError(new TimeoutError(URL_X))).toBe(false);
    expect(isHostBlockedError(new SchemaChangedError(URL_X, 'x'))).toBe(false);
    expect(isHostBlockedError(new Error('boom'))).toBe(false);
  });
});
