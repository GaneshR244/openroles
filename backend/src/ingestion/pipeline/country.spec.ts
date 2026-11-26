import { countryFromCode, isPlainRemote, resolveCountries } from './country.js';

/** The best country for these locations (the first one), or null when none can be told. */
function best(locations: string[], countryCodes: string[] = []): string | null {
  return resolveCountries({ locations, countryCodes }).countries[0] ?? null;
}

describe('resolveCountries: India, UAE and US text', () => {
  it.each<[string, string | null]>([
    ['Bengaluru-VTP, India', 'IN'],
    ['Bengaluru, Karnataka, India', 'IN'],
    ['Chennai, IN', 'IN'],
    ['Indianapolis, IN', 'US'],
    ['New York, NY (HQ)', 'US'],
    ['Dubai - UAE', 'AE'],
    ['Remote - India', 'IN'],
    ['Hyderabad', 'IN'],
    ['Bangalore', 'IN'],
    ['Bombay', 'IN'],
    ['Gurgaon, Haryana', 'IN'],
    ['Kochi, Kerala', 'IN'],
    ['Tamil Nadu', 'IN'],
    ['Punjab', 'IN'],
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
    ['Remote - North America', 'US'],
    // "City, ST": a state code that is not also a country code is enough
    ['Plano, TX', 'US'],
    ['Austin, TX 78701', 'US'],
    ['Smalltown, TX', 'US'],
    ['Smallville, KS 66002', 'US'],
    ['Smallville, KS (Hybrid)', 'US'],
    ['Vancouver, WA', 'US'],
    ['Paris, TX', 'US'],
    ['Lebanon, NH', 'US'],
    ['Jersey City, NJ', 'US'],
    // ...a state code that is also a country code needs a known city
    ['Chicago, IL', 'US'],
    ['Bentonville, AR', 'US'],
    ['Richmond, VA', 'US'],
    ['Columbia, SC', 'US'],
    ['Springfield, IL', 'US'],
    ['Foo Park, Springfield, MA', 'US'],
    ['New Mexico', 'US'],
    ['Albuquerque, New Mexico', 'US'],
    // Georgia is a country too
    ['Atlanta, Georgia', 'US'],
    ['Georgia, USA', 'US'],
  ])('%j -> %s', (location, expected) => {
    expect(best([location])).toBe(expected);
  });
});

describe('resolveCountries: the rest of the world', () => {
  it.each<[string, string | null]>([
    ['Berlin, DE', 'DE'],
    ['Munich, Germany', 'DE'],
    ['Tel Aviv, IL', 'IL'],
    ['Toronto, CA', 'CA'],
    ['Toronto, ON', 'CA'],
    ['Buenos Aires, AR', 'AR'],
    ['Jakarta, ID', 'ID'],
    ['London, UK', 'GB'],
    ['London, England', 'GB'],
    ['Edinburgh', 'GB'],
    ['Remote - Canada', 'CA'],
    ['Singapore', 'SG'],
    ['Mexico City', 'MX'],
    ['São Paulo', 'BR'],
    ['Sydney, NSW', 'AU'],
    ['St Helier, Jersey', 'JE'],
    ['Hyderabad, Pakistan', 'PK'],
    ['Hyderabad, Sindh', 'PK'],
    ['Lahore, Punjab', 'PK'],
    ['Tbilisi, Georgia', 'GE'],
    // a country name beats a city in the same location
    ['London, Ontario, Canada', 'CA'],
    // a city that also exists elsewhere counts only on its own, as the best-known one
    ['Paris', 'FR'],
    ['London', 'GB'],
  ])('%j -> %s', (location, expected) => {
    expect(best([location])).toBe(expected);
  });
});

describe('resolveCountries: no country we can tell', () => {
  it.each<[string, boolean]>([
    // [location, plainRemote]
    ['Remote', true],
    ['Anywhere', true],
    ['Worldwide', true],
    ['Work from home', true],
    ['Fully Remote', true],
    ['', true],
    ['Remote - IN', true],
    ['Remote, IN', true],
    ['Remote - EMEA', false],
    ['Remote - Latin America', false],
    ['Remote, CA', false],
    ['Smalltown, CA', false],
    ['Richmond, BC', false],
    ['Richmond', false],
    ['Springfield', false],
    ['Smalltown, tx', false],
    ['Georgia', false],
  ])('%j -> no country (plain remote: %s)', (location, plainRemote) => {
    expect(resolveCountries({ locations: [location], countryCodes: [] })).toEqual({
      countries: [],
      plainRemote,
    });
  });
});

describe('resolveCountries: several locations, in order', () => {
  it.each<[string[], string[]]>([
    [['London', 'Pune'], ['GB', 'IN']],
    [['Austin, TX', 'Pune'], ['US', 'IN']],
    [['Remote', 'Dubai'], ['AE']],
    [['Paris', 'Berlin'], ['FR', 'DE']],
    [['Pune', 'Bengaluru'], ['IN']],
    [['Hyderabad', 'Karachi, Pakistan'], ['PK']],
    [['Hyderabad', 'Karachi, Pakistan', 'Pune'], ['PK', 'IN']],
    [[], []],
  ])('%j -> %j', (locations, expected) => {
    expect(resolveCountries({ locations, countryCodes: [] }).countries).toEqual(expected);
  });
});

describe('resolveCountries: structured codes come first', () => {
  it.each<[string[], string[], string[]]>([
    [['USA'], [], ['US']],
    [['us'], ['Paris'], ['US', 'FR']],
    [['IND'], [], ['IN']],
    [['India'], [], ['IN']],
    [['ARE'], [], ['AE']],
    [['Germany'], [], ['DE']],
    [['FR'], ['Paris'], ['FR']],
    [['FR', 'IN'], ['Paris'], ['FR', 'IN']],
    [['GB'], ['London', 'Bengaluru'], ['GB', 'IN']],
    [['PK'], ['Hyderabad'], ['PK']],
    [['XX'], ['Pune'], ['IN']],
    [['', '  '], ['Pune'], ['IN']],
  ])('codes %j, locations %j -> %j', (countryCodes, locations, expected) => {
    expect(resolveCountries({ locations, countryCodes }).countries).toEqual(expected);
  });

  it('a code means the job is somewhere, so it is not plain remote', () => {
    expect(resolveCountries({ locations: ['Remote'], countryCodes: ['FR'] })).toEqual({
      countries: ['FR'],
      plainRemote: false,
    });
    expect(resolveCountries({ locations: ['Remote'], countryCodes: [' '] }).plainRemote).toBe(true);
  });
});

describe('countryFromCode', () => {
  it.each<[string, string | undefined]>([
    ['in', 'IN'],
    ['UK', 'GB'],
    ['GBR', 'GB'],
    ['United Kingdom', 'GB'],
    ['Côte d’Ivoire', 'CI'],
    ['GE', 'GE'],
    ['XX', undefined],
    ['Atlantis', undefined],
    ['', undefined],
  ])('%j -> %s', (code, expected) => {
    expect(countryFromCode(code)).toBe(expected);
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
