"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFilterNavigation } from "@/components/filter-navigation";
import { VIEWS } from "@/lib/filters";
import { VIEW_LABELS } from "@/lib/labels";

export function ViewTabs() {
  const { filters, navigate } = useFilterNavigation();
  return (
    <Tabs
      value={filters.view}
      onValueChange={(value) => {
        const view = VIEWS.find((v) => v === value);
        if (view) navigate({ view });
      }}
    >
      <TabsList aria-label="Which roles">
        {VIEWS.map((view) => (
          <TabsTrigger key={view} value={view} className="px-3">
            {VIEW_LABELS[view]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
