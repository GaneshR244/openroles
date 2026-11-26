import {
  cleanLocation,
  fingerprint,
  normalizeCompany,
  normalizeLocation,
  normalizeText,
  normalizeTitle,
} from './normalize.js';

describe('normalizeText', () => {
  it.each([
    ['  Hello   World  ', 'hello world'],
    ['Café Münchën', 'cafe munchen'],
    ['AT&T', 'at and t'],
    ['Bengaluru-VTP, India', 'bengaluru vtp india'],
    ['C++ / .NET Dev (Sr.)', 'c net dev sr'],
    ['ﬁnance', 'finance'],
    ['---', ''],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('normalizeCompany', () => {
  it.each([
    ['Acme Payments Pvt. Ltd.', 'acme payments'],
    ['Acme Payments Private Limited', 'acme payments'],
    ['Acme FZ-LLC', 'acme'],
    ['Acme FZCO', 'acme'],
    ['Acme DMCC', 'acme'],
    ['Zoho Corporation', 'zoho'],
    ['Stripe, Inc.', 'stripe'],
    ['Globex Co., Ltd.', 'globex'],
    ['Initech GmbH', 'initech'],
    ['Acme Technologies Pvt Ltd', 'acme technologies'],
    ['Acme Labs', 'acme labs'],
    // Only trailing suffixes go; a leading one stays.
    ['Co Labs Inc', 'co labs'],
    // Stripping would leave nothing, so the normalized text is kept.
    ['Inc.', 'inc'],
    ['Private Limited', 'private limited'],
    // Dotted initials are joined first, so they match the plain spelling.
    ['Société Générale S.A.', 'societe generale'],
    ['Acme Trading L.L.C.', 'acme trading'],
    ['Acme Trading LLC', 'acme trading'],
    ['J.P. Morgan', 'jp morgan'],
    ['Booking.com', 'booking com'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeCompany(input)).toBe(expected);
  });

  it('gives the same key for both legal spellings', () => {
    expect(normalizeCompany('Acme Payments Pvt. Ltd.')).toBe(
      normalizeCompany('Acme Payments Private Limited'),
    );
  });
});

describe('normalizeTitle', () => {
  it.each([
    ['Sr. Software Eng', 'senior software engineer'],
    ['Senior Software Engineer', 'senior software engineer'],
    ['Jr Dev', 'junior developer'],
    ['Sales Mgr', 'sales manager'],
    ['Account Exec', 'account executive'],
    // Whole words only.
    ['Engineering Manager', 'engineering manager'],
    ['DevOps Engineer', 'devops engineer'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it('gives the same key for abbreviated and full titles', () => {
    expect(normalizeTitle('Sr. Software Eng')).toBe(normalizeTitle('Senior Software Engineer'));
  });
});

describe('normalizeLocation', () => {
  it.each([
    ['Bengaluru, Karnataka', 'bengaluru karnataka'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeLocation(input)).toBe(expected);
  });
});

describe('fingerprint', () => {
  it('is 40 lowercase hex characters', () => {
    expect(fingerprint('Acme', 'Engineer', 'Pune')).toMatch(/^[0-9a-f]{40}$/);
  });

  it('is stable across calls and known for a fixed input', () => {
    const a = fingerprint('Acme Pvt Ltd', 'Sr. Dev', 'Pune, India');
    expect(fingerprint('Acme Pvt Ltd', 'Sr. Dev', 'Pune, India')).toBe(a);
    // sha1("acme|senior developer|pune india")
    expect(a).toBe('79a1e785790583ff574cb020670940b2f1d2ee7b');
  });

  it('ignores legal suffixes, abbreviations, case and punctuation', () => {
    expect(fingerprint('Acme Payments Pvt. Ltd.', 'Sr. Software Eng', 'Pune, India')).toBe(
      fingerprint('ACME PAYMENTS PRIVATE LIMITED', 'Senior Software Engineer', 'pune india'),
    );
  });

  it('treats a missing location as empty', () => {
    expect(fingerprint('Acme', 'Engineer', null)).toBe(fingerprint('Acme', 'Engineer', ''));
  });

  it('changes when any part changes', () => {
    const base = fingerprint('Acme', 'Engineer', 'Pune');
    expect(fingerprint('Acme', 'Engineer', 'Mumbai')).not.toBe(base);
    expect(fingerprint('Acme', 'Designer', 'Pune')).not.toBe(base);
    expect(fingerprint('Globex', 'Engineer', 'Pune')).not.toBe(base);
  });
});

describe('cleanLocation', () => {
  it.each([
    ['Hyderabad, , India', 'Hyderabad, India'],
    ['United States, UNITED STATES', 'United States'],
    ['Singapore, Singapore', 'Singapore'],
    ['New York, New York, United States', 'New York, New York, United States'],
    [' Pune ,Maharashtra, India ', 'Pune, Maharashtra, India'],
    [', ,', ''],
    ['Remote', 'Remote'],
  ])('%j -> %j', (text, expected) => {
    expect(cleanLocation(text)).toBe(expected);
  });
});
