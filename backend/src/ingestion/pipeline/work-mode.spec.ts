import type { WorkMode } from '../../generated/prisma/enums.js';
import { resolveWorkMode, type WorkModeInput } from './work-mode.js';

const base: WorkModeInput = { locations: ['Pune'], title: 'Software Engineer' };

describe('resolveWorkMode: structured hint', () => {
  it.each<[string, WorkMode]>([
    ['onsite', 'ONSITE'],
    ['on site', 'ONSITE'],
    ['on-site', 'ONSITE'],
    ['on_site', 'ONSITE'],
    ['OnSite', 'ONSITE'],
    ['ON_SITE', 'ONSITE'],
    ['office', 'ONSITE'],
    ['Hybrid', 'HYBRID'],
    ['remote', 'REMOTE'],
    ['REMOTE', 'REMOTE'],
  ])('%j -> %s', (workModeHint, expected) => {
    expect(resolveWorkMode({ ...base, workModeHint })).toBe(expected);
  });

  it('wins over text', () => {
    expect(resolveWorkMode({ workModeHint: 'onsite', locations: ['Remote'], title: 'Dev' })).toBe(
      'ONSITE',
    );
  });

  it.each(['unspecified', 'unknown', 'flexible', ''])(
    'ignores %j and falls back to text',
    (hint) => {
      expect(resolveWorkMode({ ...base, workModeHint: hint })).toBe('UNKNOWN');
      expect(resolveWorkMode({ workModeHint: hint, locations: ['Remote'], title: 'Dev' })).toBe(
        'REMOTE',
      );
    },
  );
});

describe('resolveWorkMode: text', () => {
  it.each<[string[], string, WorkMode]>([
    [['Remote - US'], 'Account Executive', 'REMOTE'],
    [['Pune'], 'Sales Manager (Remote)', 'REMOTE'],
    [['Mumbai (WFH)'], 'Engineer', 'REMOTE'],
    [['Work from home'], 'Engineer', 'REMOTE'],
    [['Bengaluru - Hybrid'], 'Engineer', 'HYBRID'],
    [['Pune'], 'Hybrid Product Designer', 'HYBRID'],
    [['Hybrid'], 'Engineer, remote-friendly', 'HYBRID'],
    [['Pune'], 'Software Engineer', 'UNKNOWN'],
    [[], 'Software Engineer', 'UNKNOWN'],
    // Never ONSITE from text.
    [['On-site, Pune'], 'Office Manager', 'UNKNOWN'],
    // Whole words only.
    [['Pune'], 'Remotely Piloted Systems Lead', 'UNKNOWN'],
  ])('%j / %j -> %s', (locations, title, expected) => {
    expect(resolveWorkMode({ locations, title })).toBe(expected);
  });
});
