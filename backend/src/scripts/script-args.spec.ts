import { flag, parseSource } from './script-args.js';

describe('script args', () => {
  it('reads flags', () => {
    expect(flag(['--source=lever', '--trigger=cron'], 'trigger')).toBe('cron');
    expect(flag([], 'source')).toBeUndefined();
  });

  it('parses a board system name', () => {
    expect(parseSource('lever')).toBe('LEVER');
    expect(parseSource('SmartRecruiters')).toBe('SMARTRECRUITERS');
    expect(parseSource(undefined)).toBeUndefined();
    expect(() => parseSource('linkdin')).toThrow(/Unknown --source/);
  });
});
