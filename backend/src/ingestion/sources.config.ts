// What to fetch (docs/ARCHITECTURE.md §3.10). Changes here go through code review.

/** `country` is the ISO code jobs from this search get when their location is unclear. */
export type LinkedInSearch = { location: string; country: string; priority: number };

/** City searches for the LinkedIn lane (used only when LINKEDIN_ENABLED=true). Lower priority runs first. */
export const LINKEDIN_SEARCHES: readonly LinkedInSearch[] = [
  { location: 'Bengaluru, Karnataka, India', country: 'IN', priority: 1 },
  { location: 'Mumbai, Maharashtra, India', country: 'IN', priority: 1 },
  { location: 'Delhi, India', country: 'IN', priority: 1 },
  { location: 'Hyderabad, Telangana, India', country: 'IN', priority: 1 },
  { location: 'Chennai, Tamil Nadu, India', country: 'IN', priority: 1 },
  { location: 'Pune, Maharashtra, India', country: 'IN', priority: 2 },
  { location: 'Gurugram, Haryana, India', country: 'IN', priority: 2 },
  { location: 'Noida, Uttar Pradesh, India', country: 'IN', priority: 2 },
  { location: 'Kolkata, West Bengal, India', country: 'IN', priority: 3 },
  { location: 'Ahmedabad, Gujarat, India', country: 'IN', priority: 3 },
  { location: 'Dubai, United Arab Emirates', country: 'AE', priority: 1 },
  { location: 'Abu Dhabi, United Arab Emirates', country: 'AE', priority: 2 },
  { location: 'Sharjah, United Arab Emirates', country: 'AE', priority: 3 },
  { location: 'New York, New York, United States', country: 'US', priority: 1 },
  { location: 'San Francisco Bay Area', country: 'US', priority: 1 },
  { location: 'Austin, Texas, United States', country: 'US', priority: 2 },
  { location: 'Seattle, Washington, United States', country: 'US', priority: 2 },
  { location: 'Boston, Massachusetts, United States', country: 'US', priority: 2 },
  { location: 'Chicago, Illinois, United States', country: 'US', priority: 3 },
  { location: 'Los Angeles, California, United States', country: 'US', priority: 3 },
];

/**
 * Normalized company names whose posts are junk for sales (e.g. job-spam aggregators).
 * Never add recruitment agencies: they are customers.
 */
export const COMPANY_BLOCKLIST: ReadonlySet<string> = new Set<string>([]);

/** The Apify actor that reads LinkedIn for us (LINKEDIN_PROVIDER=apify). */
export const APIFY_LINKEDIN_ACTOR = 'curious_coder~linkedin-jobs-scraper';

/** Searches sent to Apify. The daily limit is split evenly between them. */
export const APIFY_LINKEDIN_SEARCHES: readonly { location: string; country: string }[] = [
  { location: 'India', country: 'IN' },
  { location: 'United Arab Emirates', country: 'AE' },
  { location: 'United States', country: 'US' },
];
