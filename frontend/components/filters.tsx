"use client";

import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilterNavigation } from "@/components/filter-navigation";
import { SOURCES, normalizeQuery } from "@/lib/filters";
import { countryLabel, SOURCE_LABELS } from "@/lib/labels";
import type { CountryCount } from "@/lib/types";

const SEARCH_DEBOUNCE_MS = 300;

const numberFormat = new Intl.NumberFormat("en-IN");

/** `countries`: countries with open roles, most first (from the API). */
export function Filters({ countries }: { countries: CountryCount[] }) {
  const { filters, navigate } = useFilterNavigation();
  const countryOptions = countries.map(({ code, jobs }) => ({
    value: code,
    label: `${countryLabel(code)} (${numberFormat.format(jobs)})`,
  }));
  // A country from a shared link that has no roles right now still shows as selected.
  if (filters.country && !countries.some((c) => c.code === filters.country)) {
    countryOptions.unshift({ value: filters.country, label: countryLabel(filters.country) });
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <SearchBox />
      <FilterSelect
        label="Country"
        allLabel="All countries"
        value={filters.country}
        options={countryOptions}
        onChange={(country) => navigate({ country })}
      />
      <FilterSelect
        label="Source"
        allLabel="All sources"
        value={filters.source}
        options={SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] }))}
        onChange={(source) => navigate({ source })}
      />
    </div>
  );
}

function SearchBox() {
  const { filters, navigate } = useFilterNavigation();
  const q = filters.q;
  const [text, setText] = useState(q ?? "");
  const [shownQ, setShownQ] = useState(q); // the URL value the box last saw
  const [sentQ, setSentQ] = useState(q); // the value this box last put in the URL

  // The URL changed without this box (a reset link, a shared link): show the new value.
  if (q !== shownQ) {
    setShownQ(q);
    if (q !== sentQ) setText(q ?? "");
  }

  useEffect(() => {
    const next = normalizeQuery(text); // under 2 characters means no search
    if (next === q) return;
    const timer = setTimeout(() => {
      setSentQ(next);
      navigate({ q: next });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, q, navigate]);

  return (
    <div className="relative w-full sm:w-72">
      <SearchIcon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search role or company"
        aria-label="Search role or company"
        className="pl-8"
      />
    </div>
  );
}

const ALL = "all";

type FilterSelectProps<T extends string> = {
  label: string;
  allLabel: string;
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (value: T | undefined) => void;
};

function FilterSelect<T extends string>({
  label,
  allLabel,
  value,
  options,
  onChange,
}: FilterSelectProps<T>) {
  const items = [{ value: ALL, label: allLabel }, ...options];
  return (
    <Select
      items={items}
      value={value ?? ALL}
      onValueChange={(selected) => onChange(options.find((o) => o.value === selected)?.value)}
    >
      <SelectTrigger aria-label={label} className="w-full sm:w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
