"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterNavigation } from "@/components/filter-navigation";
import { MODES, type Mode } from "@/lib/filters";

const MODE_LABELS: Record<Mode, string> = {
  jobs: "By job",
  companies: "By company",
};

export function ModeToggle() {
  const { mode, navigate } = useFilterNavigation();
  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        const next = MODES.find((m) => m === value);
        if (next) navigate({ mode: next });
      }}
    >
      <TabsList aria-label="Group results">
        {MODES.map((m) => (
          <TabsTrigger key={m} value={m} className="px-3">
            {MODE_LABELS[m]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
