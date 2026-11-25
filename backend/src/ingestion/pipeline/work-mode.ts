import { WorkMode } from '../../generated/prisma/enums.js';
import { normalizeText } from './normalize.js';

export type WorkModeInput = { workModeHint?: string; locations: string[]; title: string };

/** Structured work types, lowercased with spaces, dashes and underscores removed. */
const HINT_MODES = new Map<string, WorkMode>([
  ['onsite', WorkMode.ONSITE],
  ['office', WorkMode.ONSITE],
  ['hybrid', WorkMode.HYBRID],
  ['remote', WorkMode.REMOTE],
]);

/**
 * Work mode (docs/ARCHITECTURE.md §3.6): the source's structured hint first, then keywords in
 * the locations and title. ONSITE comes only from a hint, never from text.
 */
export function resolveWorkMode(input: WorkModeInput): WorkMode {
  const fromHint = input.workModeHint ? HINT_MODES.get(hintKey(input.workModeHint)) : undefined;
  return fromHint ?? workModeFromText([...input.locations, input.title].join(' '));
}

function hintKey(hint: string): string {
  return hint.toLowerCase().replace(/[\s_-]+/g, '');
}

function workModeFromText(text: string): WorkMode {
  const padded = ` ${normalizeText(text)} `;
  // Hybrid jobs often mention remote days ("Hybrid, 2 days remote"), so hybrid is checked first.
  if (padded.includes(' hybrid ')) return WorkMode.HYBRID;
  if (/ (remote|wfh|work from home) /.test(padded)) return WorkMode.REMOTE;
  return WorkMode.UNKNOWN;
}
