import { createHash } from 'node:crypto';

/** Legal-form words removed from the end of a company name (docs/ARCHITECTURE.md §3.5). */
const LEGAL_SUFFIXES = new Set([
  // general
  'pvt',
  'private',
  'ltd',
  'limited',
  'inc',
  'incorporated',
  'llc',
  'llp',
  'plc',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'bv',
  'sa',
  // UAE ("FZ-LLC" becomes "fz llc", which the loop strips one word at a time)
  'fz',
  'fzc',
  'fzco',
  'fze',
  'dmcc',
]);

/** Whole-word abbreviations expanded in job titles. */
const TITLE_WORDS = new Map([
  ['sr', 'senior'],
  ['jr', 'junior'],
  ['mgr', 'manager'],
  ['eng', 'engineer'],
  ['dev', 'developer'],
  ['exec', 'executive'],
]);

/** Lowercase words only: no accents, "&" spelled "and", one space between words. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Dotted initials such as "S.A." or "L.L.C.", so they can be joined into "SA" or "LLC". */
const DOTTED_INITIALS = /(?<!\p{L})(?:\p{L}\.){2,}/gu;

/** Company dedupe key: normalized text without trailing legal suffixes. Never empty unless the input is. */
export function normalizeCompany(name: string): string {
  const joined = name.replace(DOTTED_INITIALS, (initials) => initials.replace(/\./g, ''));
  const text = normalizeText(joined);
  const words = text.split(' ');
  while (words.length > 0 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.length > 0 ? words.join(' ') : text;
}

/** Title key: normalized text with common abbreviations spelled out. */
export function normalizeTitle(t: string): string {
  return normalizeText(t)
    .split(' ')
    .map((word) => TITLE_WORDS.get(word) ?? word)
    .join(' ');
}

/** Location key: normalized text, or '' when there is no location. */
export function normalizeLocation(l: string | null | undefined): string {
  return l ? normalizeText(l) : '';
}

/** sha1 of the company, title and location keys: 40 hex characters. */
export function fingerprint(
  company: string,
  title: string,
  location: string | null | undefined,
): string {
  const key = `${normalizeCompany(company)}|${normalizeTitle(title)}|${normalizeLocation(location)}`;
  return createHash('sha1').update(key).digest('hex');
}

/**
 * Tidies a location for display: drops empty parts and a last part that repeats the one before
 * it. "Hyderabad, , India" -> "Hyderabad, India"; "United States, UNITED STATES" -> "United States".
 */
export function cleanLocation(text: string): string {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const last = parts.at(-1);
  const beforeLast = parts.at(-2);
  if (last && beforeLast && last.toLowerCase() === beforeLast.toLowerCase()) parts.pop();
  return parts.join(', ');
}
