"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilterNavigation } from "@/components/filter-navigation";
import { PAGE_SIZES } from "@/lib/filters";

/** "Rows per page" picker. Changing it goes back to page 1 and is kept in the link. */
export function PageSizeSelect() {
  const { filters, navigate } = useFilterNavigation();
  const items = PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Rows per page
      <Select
        items={items}
        value={String(filters.pageSize)}
        onValueChange={(value) => navigate({ pageSize: Number(value) })}
      >
        <SelectTrigger aria-label="Rows per page" size="sm" className="w-20">
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
    </label>
  );
}
