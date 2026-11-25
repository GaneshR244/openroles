import { z } from 'zod';
import { SchemaChangedError } from '../../common/http/errors.js';

// One zod schema per source (docs/ARCHITECTURE.md §3.3), checked against real responses in
// test/fixtures. Each schema lists only the fields a reader uses. Other fields are allowed and
// dropped. A field the reader's logic depends on is required, so a format change fails loudly
// instead of looking like an empty board.

const text = z.string().nullish();

export const greenhouseJobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      company_name: text,
      location: z.object({ name: text }).nullish(),
      absolute_url: z.string(),
      first_published: text,
      updated_at: text,
    }),
  ),
});
export type GreenhouseJob = z.output<typeof greenhouseJobsSchema>['jobs'][number];

export const leverPostingsSchema = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    categories: z
      .object({
        location: text,
        allLocations: z.array(z.string()).nullish(),
      })
      .nullish(),
    country: text,
    workplaceType: text,
    hostedUrl: z.string(),
    createdAt: z.number().nullish(),
  }),
);
export type LeverPosting = z.output<typeof leverPostingsSchema>[number];

const ashbyAddress = z.object({ postalAddress: z.object({ addressCountry: text }).nullish() });

export const ashbyJobBoardSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      location: text,
      secondaryLocations: z.array(z.object({ location: text })).nullish(),
      address: ashbyAddress.nullish(),
      workplaceType: text,
      isRemote: z.boolean().nullish(),
      isListed: z.boolean(),
      jobUrl: z.string(),
      publishedAt: text,
    }),
  ),
});
export type AshbyJob = z.output<typeof ashbyJobBoardSchema>['jobs'][number];

export const smartRecruitersPageSchema = z.object({
  offset: z.number(),
  limit: z.number(),
  totalFound: z.number(),
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      company: z.object({ name: text }).nullish(),
      location: z
        .object({
          city: text,
          region: text,
          country: text,
          fullLocation: text,
          remote: z.boolean().nullish(),
          hybrid: z.boolean().nullish(),
        })
        .nullish(),
      releasedDate: text,
    }),
  ),
});
export type SmartRecruitersPosting = z.output<typeof smartRecruitersPageSchema>['content'][number];

const workableLocation = z.object({ city: text, region: text, country: text, countryCode: text });

export const workableJobsSchema = z.object({
  total: z.number().nullish(),
  nextPage: text,
  results: z.array(
    z.object({
      shortcode: z.string(),
      title: z.string(),
      remote: z.boolean().nullish(),
      location: workableLocation.nullish(),
      locations: z.array(workableLocation).nullish(),
      workplace: text,
      published: text,
    }),
  ),
});
export type WorkableJob = z.output<typeof workableJobsSchema>['results'][number];

/** Validates a response, or throws SchemaChangedError naming the first field that broke. */
export function parseResponse<S extends z.ZodType>(
  schema: S,
  data: unknown,
  url: string,
): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
  throw new SchemaChangedError(url, `${path}: ${issue.message}`);
}
