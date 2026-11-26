import {
  INDIA_PLACES,
  NON_TARGET_PHRASES,
  UAE_PLACES,
  US_CITIES_WITH_STATE,
  US_PLACES,
  US_STATE_CODES_NOT_COUNTRIES,
} from './country-data.js';
import { normalizeText } from './normalize.js';
import type { CountryMatch } from './pipeline.types.js';
import { FALLBACK_CITIES, ISO3_CODES, WORLD_CITIES, WORLD_COUNTRY_NAMES } from './world-places.js';

export type CountryInput = { locations: string[]; countryCodes: string[] };

type Level = 'country' | 'place';

/** The words in country-data.ts that name a whole country (the rest are states and cities). */
const IN_AE_US_COUNTRY_WORDS: Readonly<Record<string, readonly string[]>> = {
  IN: ['india'],
  AE: ['uae', 'u.a.e.', 'united arab emirates', 'emirates'],
  US: ['usa', 'us', 'u.s.', 'u.s.a.', 'united states', 'united states of america', 'america'],
};

/** Every ISO code we know, including Georgia, whose name is handled as a US state. */
const KNOWN_CODES = new Set([...Object.keys(WORLD_COUNTRY_NAMES), 'IN', 'AE', 'US', 'GE']);

/** Normalized place name -> country and whether it names the whole country. Built once. */
const PLACES = buildPlaces();
const IGNORED_PHRASES = new Set(NON_TARGET_PHRASES.map(normalizeText));
const MAX_PHRASE_WORDS = Math.max(
  ...[...PLACES.keys(), ...IGNORED_PHRASES].map((key) => key.split(' ').length),
);
/** Normalized country name -> code, for structured fields that send a name ("Germany"). */
const COUNTRY_NAME_CODES = new Map(
  [...PLACES].filter(([, p]) => p.level === 'country').map(([key, p]) => [key, p.country]),
);
const FALLBACKS = new Map(Object.entries(FALLBACK_CITIES));
const SAFE_STATE_CODES = new Set(US_STATE_CODES_NOT_COUNTRIES);
/** State code -> normalized city names that count only next to that code. */
const CITIES_WITH_STATE = new Map(
  Object.entries(US_CITIES_WITH_STATE).map(([code, cities]) => [
    code,
    new Set(cities.map(normalizeText)),
  ]),
);

/** Places that are also in Pakistan: they count as India unless the job points to Pakistan. */
const ALSO_IN_PAKISTAN = new Set(['hyderabad', 'punjab']);
const PAKISTAN_WORDS = new Set([
  'pakistan',
  'sindh',
  'karachi',
  'lahore',
  'islamabad',
  'rawalpindi',
]);
/** Georgia is also a country, so it counts as the US state only next to another US place. */
const GEORGIA = 'georgia';

/** Words that say "remote" without naming a place. "in" covers "Remote - IN" (§3.6). */
const REMOTE_WORDS = new Set([
  'remote',
  'anywhere',
  'worldwide',
  'global',
  'work',
  'from',
  'home',
  'wfh',
  'fully',
  'in',
]);

/** "City, ST", "City, ST 94105" or "City, ST (HQ)", with ST in capitals. */
const CITY_STATE_PATTERN = /^(.+),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:\(.*\))?$/;

/**
 * Where a job is (docs/ARCHITECTURE.md, "As built: worldwide"). Returns every country the job
 * points to, best first: structured codes, then each location in order. Within one location a
 * country name beats a city ("London, Ontario, Canada" is Canada). `plainRemote` is true when
 * there is nothing to go on but "remote" (or no location at all).
 */
export function resolveCountries(input: CountryInput): CountryMatch {
  const fromCodes = input.countryCodes
    .map((code) => countryFromCode(code))
    .filter((c): c is string => c !== undefined);

  const pointsToPakistan =
    fromCodes.includes('PK') ||
    input.locations.some((location) => words(location).some((w) => PAKISTAN_WORDS.has(w)));

  const countries = [...fromCodes];
  for (const location of input.locations) {
    countries.push(...countriesInLocation(location, pointsToPakistan));
  }
  const unique = [...new Set(countries)];
  return {
    countries: unique,
    plainRemote: unique.length === 0 && input.locations.every(isPlainRemote),
  };
}

/** True when the text names no place: "Remote", "Anywhere", "Work from home", "" and the like. */
export function isPlainRemote(text: string): boolean {
  return words(text).every((word) => REMOTE_WORDS.has(word));
}

/** "IN", "in", "IND", "UK", "Germany" -> an ISO 3166-1 alpha-2 code, or undefined. */
export function countryFromCode(raw: string): string | undefined {
  const code = raw.trim().toUpperCase().replace(/\s+/g, ' ');
  if (code === '') return undefined;
  if (code === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(code)) return KNOWN_CODES.has(code) ? code : undefined;
  if (/^[A-Z]{3}$/.test(code) && ISO3_CODES[code]) return ISO3_CODES[code];
  return COUNTRY_NAME_CODES.get(normalizeText(raw));
}

/** Countries named in one location, best first. */
function countriesInLocation(location: string, pointsToPakistan: boolean): string[] {
  const found: string[] = [];
  if (isSafeUsCityState(location)) found.push('US');

  const matches = placeMatches(location, pointsToPakistan);
  found.push(...matches.filter((m) => m.level === 'country').map((m) => m.country));
  found.push(...matches.filter((m) => m.level === 'place').map((m) => m.country));
  if (isListedUsCityState(location)) found.push('US');

  if (found.length === 0) {
    const fallback = words(location)
      .map((w) => FALLBACKS.get(w))
      .find((c) => c !== undefined);
    if (fallback) found.push(fallback);
  }
  return found;
}

type PlaceMatch = { key: string; country: string; level: Level };

function placeMatches(location: string, pointsToPakistan: boolean): PlaceMatch[] {
  const matches = findPlaces(words(location));
  const hasOtherUsPlace = matches.some((m) => m.country === 'US' && m.key !== GEORGIA);
  return matches
    .filter((m) => !(pointsToPakistan && ALSO_IN_PAKISTAN.has(m.key)))
    .filter((m) => !(m.key === GEORGIA && !hasOtherUsPlace));
}

/** Scans the words left to right, trying the longest phrase first at each position. */
function findPlaces(tokens: string[]): PlaceMatch[] {
  const matches: PlaceMatch[] = [];
  let i = 0;
  while (i < tokens.length) {
    const length = longestPhraseAt(tokens, i);
    if (length === 0) {
      i += 1;
      continue;
    }
    const key = tokens.slice(i, i + length).join(' ');
    const place = PLACES.get(key);
    if (place) matches.push({ key, ...place });
    i += length;
  }
  return matches;
}

function longestPhraseAt(tokens: string[], start: number): number {
  for (let length = Math.min(MAX_PHRASE_WORDS, tokens.length - start); length > 0; length--) {
    const key = tokens.slice(start, start + length).join(' ');
    if (PLACES.has(key) || IGNORED_PHRASES.has(key)) return length;
  }
  return 0;
}

/** "Plano, TX": a state code that is not also a country code, so it can only be the US. */
function isSafeUsCityState(location: string): boolean {
  const parts = cityState(location);
  return parts !== null && SAFE_STATE_CODES.has(parts.code);
}

/**
 * "Richmond, VA": a state code that is also a country code ("Berlin, DE", "Toronto, CA") counts
 * only when the city is one listed for that state.
 */
function isListedUsCityState(location: string): boolean {
  const parts = cityState(location);
  if (!parts || SAFE_STATE_CODES.has(parts.code)) return false;
  const city = normalizeText(parts.city.slice(parts.city.lastIndexOf(',') + 1));
  return CITIES_WITH_STATE.get(parts.code)?.has(city) ?? false;
}

function cityState(location: string): { city: string; code: string } | null {
  const match = CITY_STATE_PATTERN.exec(location.trim());
  if (!match) return null;
  const [, city, code] = match;
  if (isPlainRemote(city)) return null;
  return { city, code };
}

function words(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized === '' ? [] : normalized.split(' ');
}

function buildPlaces(): Map<string, { country: string; level: Level }> {
  const places = new Map<string, { country: string; level: Level }>();
  const add = (names: readonly string[], country: string, level: Level) => {
    for (const name of names) {
      const key = normalizeText(name);
      const existing = places.get(key);
      if (existing && existing.country !== country) {
        throw new Error(`Place "${key}" is listed for both ${existing.country} and ${country}`);
      }
      // A country word wins over the same word listed as a place.
      if (!existing || level === 'country') places.set(key, { country, level });
    }
  };
  add(INDIA_PLACES, 'IN', 'place');
  add(UAE_PLACES, 'AE', 'place');
  add(US_PLACES, 'US', 'place');
  for (const [code, names] of Object.entries(IN_AE_US_COUNTRY_WORDS)) add(names, code, 'country');
  for (const [code, names] of Object.entries(WORLD_COUNTRY_NAMES)) add(names, code, 'country');
  for (const [code, names] of Object.entries(WORLD_CITIES)) add(names, code, 'place');
  return places;
}
