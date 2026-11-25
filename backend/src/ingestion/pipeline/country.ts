import type { Country } from '../../generated/prisma/enums.js';
import {
  INDIA_PLACES,
  NON_TARGET_PHRASES,
  UAE_PLACES,
  US_CITIES_WITH_STATE,
  US_PLACES,
  US_STATE_CODES_NOT_COUNTRIES,
} from './country-data.js';
import { normalizeText } from './normalize.js';
import type { CountryResult } from './pipeline.types.js';

export type CountryInput = { locations: string[]; countryCodes: string[] };
export type CountryOptions = { targetCountries: readonly Country[] };

/** Structured country codes and names, upper-cased with single spaces. */
const CODE_COUNTRIES = new Map<string, Country>([
  ['IN', 'IN'],
  ['IND', 'IN'],
  ['INDIA', 'IN'],
  ['AE', 'AE'],
  ['ARE', 'AE'],
  ['UAE', 'AE'],
  ['UNITED ARAB EMIRATES', 'AE'],
  ['US', 'US'],
  ['USA', 'US'],
  ['UNITED STATES', 'US'],
  ['UNITED STATES OF AMERICA', 'US'],
]);

/** Normalized place name -> country. Built once when the module loads. */
const PLACES = buildPlaces();
const IGNORED_PHRASES = new Set(NON_TARGET_PHRASES.map(normalizeText));
const MAX_PHRASE_WORDS = Math.max(
  ...[...PLACES.keys(), ...IGNORED_PHRASES].map((key) => key.split(' ').length),
);
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
const PAKISTAN_CODES = new Set(['PK', 'PAK', 'PAKISTAN']);
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
 * Where a job is (docs/ARCHITECTURE.md §3.6).
 * - a target country when structured codes or location text place it in one;
 * - null when there are no codes and nothing to go on but "remote" (or no location at all);
 * - 'OUT' otherwise, including countries we know that are not targets.
 */
export function resolveCountry(input: CountryInput, opts: CountryOptions): CountryResult {
  const targets = new Set(opts.targetCountries);
  const codes = input.countryCodes.map((code) => code.trim()).filter((code) => code !== '');

  const fromCodes = firstTarget(codes.map(countryFromCode), targets);
  if (fromCodes) return fromCodes;

  // Codes without a target still fall through to the text: a multi-location job may give a code
  // only for its first location ("United Kingdom" plus "Bengaluru").
  const pointsToPakistan =
    codes.some((code) => PAKISTAN_CODES.has(normalizeCode(code))) ||
    input.locations.some((location) => words(location).some((w) => PAKISTAN_WORDS.has(w)));

  for (const location of input.locations) {
    const country = firstTarget(countriesInLocation(location, pointsToPakistan), targets);
    if (country) return country;
  }

  if (codes.length > 0) return 'OUT';
  return input.locations.every(isPlainRemote) ? null : 'OUT';
}

/** True when the text names no place: "Remote", "Anywhere", "Work from home", "" and the like. */
export function isPlainRemote(text: string): boolean {
  return words(text).every((word) => REMOTE_WORDS.has(word));
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, ' ');
}

function countryFromCode(code: string): Country | undefined {
  return CODE_COUNTRIES.get(normalizeCode(code));
}

function firstTarget(
  countries: (Country | undefined)[],
  targets: ReadonlySet<Country>,
): Country | null {
  return countries.find((c): c is Country => c !== undefined && targets.has(c)) ?? null;
}

/** Countries named in one location, in order. Falls back to a US "City, ST" address. */
function countriesInLocation(location: string, pointsToPakistan: boolean): Country[] {
  const fromPlaces = countriesFromPlaceNames(location, pointsToPakistan);
  if (fromPlaces.length > 0) return fromPlaces;
  return isUsCityState(location) ? ['US'] : [];
}

function countriesFromPlaceNames(location: string, pointsToPakistan: boolean): Country[] {
  const matches = findPlaces(words(location));
  const hasOtherUsPlace = matches.some((m) => m.country === 'US' && m.key !== GEORGIA);

  return matches
    .filter((m) => !(pointsToPakistan && ALSO_IN_PAKISTAN.has(m.key)))
    .filter((m) => !(m.key === GEORGIA && !hasOtherUsPlace))
    .map((m) => m.country);
}

type PlaceMatch = { key: string; country: Country };

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
    const country = PLACES.get(key);
    if (country) matches.push({ key, country });
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

/**
 * A US "City, ST" address. Only state codes that are not also country codes count on their own
 * ("Plano, TX" yes; "Berlin, DE", "Toronto, CA" no). For the others the city must be one listed
 * for that state ("Richmond, VA").
 */
function isUsCityState(location: string): boolean {
  const match = CITY_STATE_PATTERN.exec(location.trim());
  if (!match) return false;
  const [, cityPart, code] = match;
  if (isPlainRemote(cityPart)) return false;
  if (SAFE_STATE_CODES.has(code)) return true;
  const city = normalizeText(cityPart.slice(cityPart.lastIndexOf(',') + 1));
  return CITIES_WITH_STATE.get(code)?.has(city) ?? false;
}

function words(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized === '' ? [] : normalized.split(' ');
}

function buildPlaces(): Map<string, Country> {
  const places = new Map<string, Country>();
  const add = (names: readonly string[], country: Country) => {
    for (const name of names) {
      const key = normalizeText(name);
      const existing = places.get(key);
      if (existing && existing !== country) {
        throw new Error(`Place "${key}" is listed for both ${existing} and ${country}`);
      }
      places.set(key, country);
    }
  };
  add(INDIA_PLACES, 'IN');
  add(UAE_PLACES, 'AE');
  add(US_PLACES, 'US');
  return places;
}
