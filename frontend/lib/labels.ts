// Display labels for the enum values in the API contract.
import type { Country, JobSource, View } from "./types";

export const COUNTRY_LABELS: Record<Country, string> = {
  IN: "India",
  AE: "UAE",
  US: "US",
};

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
