// Display labels for the values in the API contract.
import type { Country, JobSource, View } from "./types";

/** Short names people use; every other code gets its English name. */
const COUNTRY_SHORT_NAMES: Record<string, string> = { AE: "UAE", US: "US", GB: "UK" };
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** "IN" -> "India", "AE" -> "UAE", "DE" -> "Germany". Unknown codes show as they are. */
export function countryLabel(code: Country): string {
  if (COUNTRY_SHORT_NAMES[code]) return COUNTRY_SHORT_NAMES[code];
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export const SOURCE_LABELS: Record<JobSource, string> = {
  LINKEDIN: "LinkedIn",
  GREENHOUSE: "Greenhouse",
  LEVER: "Lever",
  ASHBY: "Ashby",
  SMARTRECRUITERS: "SmartRecruiters",
  WORKABLE: "Workable",
};

export const VIEW_LABELS: Record<View, string> = {
  new: "New today",
  week: "Last 7 days",
  all: "All open",
};
