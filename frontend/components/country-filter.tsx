"use client";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { useFilterNavigation } from "@/components/filter-navigation";
import { formatCount } from "@/lib/format";
import { countryLabel } from "@/lib/labels";
import type { CountryCount } from "@/lib/types";

type Option = { code: string; label: string; jobs: number | null };

const ALL: Option = { code: "", label: "All countries", jobs: null };

/** Country filter you can type in: "ger" finds Germany. Countries with the most roles first. */
export function CountryFilter({ countries }: { countries: CountryCount[] }) {
  const { filters, navigate } = useFilterNavigation();
  const options: Option[] = [
    ALL,
    ...countries.map(({ code, jobs }) => ({ code, label: countryLabel(code), jobs })),
  ];
  // A country from a shared link that has no roles right now still shows as selected.
  if (filters.country && !options.some((o) => o.code === filters.country)) {
    options.splice(1, 0, { code: filters.country, label: countryLabel(filters.country), jobs: 0 });
  }
  const selected = options.find((o) => o.code === (filters.country ?? "")) ?? ALL;

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option) => navigate({ country: option?.code || undefined })}
      itemToStringLabel={(option) => option.label}
      isItemEqualToValue={(a, b) => a.code === b.code}
    >
      <ComboboxInput
        placeholder="Search country"
        aria-label="Country"
        className="w-full sm:w-56"
      />
      <ComboboxContent>
        <ComboboxEmpty>No country found</ComboboxEmpty>
        <ComboboxList>
          {(option: Option) => (
            <ComboboxItem key={option.code || "all"} value={option}>
              <span className="truncate">{option.label}</span>
              {option.jobs !== null && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {formatCount(option.jobs)}
                </span>
              )}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
