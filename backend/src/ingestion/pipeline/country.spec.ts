import type { Country } from '../../generated/prisma/enums.js';
import { isPlainRemote, resolveCountry } from './country.js';
import type { CountryResult } from './pipeline.types.js';

const ALL: readonly Country[] = ['IN', 'AE', 'US'];

function fromLocations(locations: string[], targets: readonly Country[] = ALL): CountryResult {
  return resolveCountry({ locations, countryCodes: [] }, { targetCountries: targets });
}

describe('resolveCountry: location text', () => {
  it.each<[string, CountryResult]>([
    // docs/ARCHITECTURE.md §8
    ['Bengaluru-VTP, India', 'IN'],
    ['Chennai, IN', 'IN'],
    ['Indianapolis, IN', 'US'],
    ['New York, NY (HQ)', 'US'],
    ['Dubai - UAE', 'AE'],
    ['Remote - India', 'IN'],
    ['Remote', null],
    ['Paris', 'OUT'],
    ['Hyderabad', 'IN'],
    ['Hyderabad, Pakistan', 'OUT'],
    // old and new city names, states, emirates
    ['Bangalore', 'IN'],
    ['Bombay', 'IN'],
    ['Gurgaon, Haryana', 'IN'],
    ['Kochi, Kerala', 'IN'],
    ['Tamil Nadu', 'IN'],
    ['Abu Dhabi', 'AE'],
    ['Ras Al Khaimah', 'AE'],
    ['Al Ain, United Arab Emirates', 'AE'],
    ['U.A.E.', 'AE'],
    ['San Francisco, CA', 'US'],
    ['Washington, D.C.', 'US'],
    ['St. Louis', 'US'],
    ['Indianapolis, Indiana', 'US'],
    ['United States of America', 'US'],
    ['Remote - US', 'US'],
    ['Remote (U.S.)', 'US'],
    // "City, ST": a state code that is not also a country code is enough
    ['Plano, TX', 'US'],
    ['Austin, TX 78701', 'US'],
    ['Smalltown, TX', 'US'],
    ['Smallville, KS 66002', 'US'],
    ['Smallville, KS (Hybrid)', 'US'],
    ['Vancouver, WA', 'US'],
    // ...a state code that is also a country code needs a known city
    ['Chicago, IL', 'US'],
    ['Indianapolis, IN', 'US'],
    ['Bentonville, AR', 'US'],
    ['Richmond, VA', 'US'],
    ['Columbia, SC', 'US'],
    ['Springfield, IL', 'US'],
    ['Foo Park, Springfield, MA', 'US'],
    ['Berlin, DE', 'OUT'],
    ['Tel Aviv, IL', 'OUT'],
    ['Toronto, CA', 'OUT'],
    ['Buenos Aires, AR', 'OUT'],
    ['Jakarta, ID', 'OUT'],
    ['Smalltown, CA', 'OUT'],
    ['Richmond, BC', 'OUT'],
    ['Richmond', 'OUT'],
    ['Springfield', 'OUT'],
    ['London, UK', 'OUT'],
    ['Toronto, ON', 'OUT'],
    ['Smalltown, tx', 'OUT'],
    // Pakistan places switch off hyderabad and punjab
    ['Hyderabad, Sindh', 'OUT'],
    ['Lahore, Punjab', 'OUT'],
    ['Punjab', 'IN'],
    // Georgia is a country too
    ['Atlanta, Georgia', 'US'],
    ['Georgia, USA', 'US'],
    ['Tbilisi, Georgia', 'OUT'],
    ['Georgia', 'OUT'],
    // "america" inside a wider region
    ['Remote - North America', 'US'],
    ['Remote - Latin America', 'OUT'],
    // plain remote and its variants
    ['Anywhere', null],
    ['Worldwide', null],
    ['Work from home', null],
    ['Fully Remote', null],
    ['', null],
    ['Remote - IN', null],
    ['Remote, IN', null],
    ['Remote - EMEA', 'OUT'],
    ['Remote, CA', 'OUT'],
    ['São Paulo', 'OUT'],
  ])('%j -> %s', (location, expected) => {
    expect(fromLocations([location])).toBe(expected);
  });
});

describe('resolveCountry: several locations', () => {
  it.each<[string[], CountryResult]>([
    [['London', 'Pune'], 'IN'],
    [['Austin, TX', 'Pune'], 'US'],
    [['Remote', 'Dubai'], 'AE'],
    [['Remote', 'Anywhere'], null],
    [['Remote', 'Paris'], 'OUT'],
    [['Paris', 'Berlin'], 'OUT'],
    [['Hyderabad', 'Karachi, Pakistan'], 'OUT'],
    [['Hyderabad', 'Karachi, Pakistan', 'Pune'], 'IN'],
    [[], null],
  ])('%j -> %s', (locations, expected) => {
    expect(fromLocations(locations)).toBe(expected);
  });
});

describe('resolveCountry: target countries', () => {
  it.each<[string[], readonly Country[], CountryResult]>([
    [['Austin, TX'], ['IN'], 'OUT'],
    [['Dubai'], ['IN', 'US'], 'OUT'],
    [['Austin, TX', 'Pune'], ['IN'], 'IN'],
    [['Remote'], ['IN'], null],
  ])('%j with %j -> %s', (locations, targets, expected) => {
    expect(fromLocations(locations, targets)).toBe(expected);
  });
});

describe('resolveCountry: structured codes', () => {
  it.each<[string[], string[], readonly Country[], CountryResult]>([
    [['USA'], [], ALL, 'US'],
    [['us'], ['Paris'], ALL, 'US'],
    [['in'], [], ALL, 'IN'],
    [['IND'], [], ALL, 'IN'],
    [['India'], [], ALL, 'IN'],
    [['ARE'], [], ALL, 'AE'],
    [['United Arab Emirates'], [], ALL, 'AE'],
    [['United States'], [], ALL, 'US'],
    [['FR'], ['Paris'], ALL, 'OUT'],
    [['FR', 'IN'], ['Paris'], ALL, 'IN'],
    [['US'], ['Austin, TX'], ['IN'], 'OUT'],
    // Codes without a target fall through to the location text.
    [['GB'], ['London', 'Bengaluru'], ALL, 'IN'],
    [['AE'], ['Dubai', 'Pune'], ['IN'], 'IN'],
    [['PK'], ['Hyderabad, Sindh'], ALL, 'OUT'],
    [['PK'], ['Hyderabad'], ALL, 'OUT'],
    [['IL'], ['Tel Aviv, IL'], ALL, 'OUT'],
    [['DE'], ['Berlin, DE'], ALL, 'OUT'],
    // ...but a code means the job is somewhere, so plain remote is OUT, not null.
    [['FR'], ['Remote'], ALL, 'OUT'],
    [['FR'], [], ALL, 'OUT'],
    // Blank codes are ignored.
    [['', '  '], ['Pune'], ALL, 'IN'],
    [[' '], ['Remote'], ALL, null],
  ])('codes %j, locations %j, targets %j -> %s', (countryCodes, locations, targets, expected) => {
    expect(resolveCountry({ locations, countryCodes }, { targetCountries: targets })).toBe(
      expected,
    );
  });
});

describe('isPlainRemote', () => {
  it.each<[string, boolean]>([
    ['Remote', true],
    ['remote', true],
    ['Anywhere', true],
    ['Worldwide', true],
    ['Work From Home', true],
    ['Remote (Worldwide)', true],
    ['', true],
    ['   ', true],
    ['Remote - India', false],
    ['Remote - EMEA', false],
    ['Pune', false],
  ])('%j -> %s', (text, expected) => {
    expect(isPlainRemote(text)).toBe(expected);
  });
});
