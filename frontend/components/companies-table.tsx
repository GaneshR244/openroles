import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RelativeTime } from "@/components/relative-time";
import { SourceBadge } from "@/components/source-badge";
import { formatCount } from "@/lib/format";
import type { CompanyItem } from "@/lib/types";

export function CompaniesTable({ companies, now }: { companies: CompanyItem[]; now: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-3">Company</TableHead>
            <TableHead className="px-3 text-right">Open roles</TableHead>
            <TableHead className="px-3 text-right">New today</TableHead>
            <TableHead className="px-3">Latest post</TableHead>
            <TableHead className="px-3">Sources</TableHead>
            <TableHead className="px-3">
              <span className="sr-only">Company page</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => {
            const href = `/companies/${encodeURIComponent(company.id)}`;
            return (
              <TableRow key={company.id}>
                <TableCell className="min-w-48 px-3 font-medium whitespace-normal">
                  <Link href={href} className="hover:underline">
                    {company.name}
                  </Link>
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {formatCount(company.openRoles)}
                </TableCell>
                <TableCell className="px-3 text-right tabular-nums">
                  {company.newToday > 0 ? (
                    <span className="font-medium">{formatCount(company.newToday)}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell className="px-3 text-muted-foreground">
                  {company.latestPostedAt ? (
                    <RelativeTime iso={company.latestPostedAt} now={now} />
                  ) : (
                    "–"
                  )}
                </TableCell>
                <TableCell className="px-3">
                  <div className="flex gap-1">
                    {company.sources.map((source) => (
                      <SourceBadge key={source} source={source} />
                    ))}
                  </div>
                </TableCell>
                <TableCell className="px-3 text-right">
                  <Link href={href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    View roles
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
