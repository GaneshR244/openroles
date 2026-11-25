import { ArrowUpRightIcon } from "lucide-react";
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
import { WorkModeBadge } from "@/components/work-mode-badge";
import { COUNTRY_LABELS } from "@/lib/labels";
import type { JobItem } from "@/lib/types";

type JobsTableProps = {
  jobs: JobItem[];
  now: number;
  /** Hide the company column on a company's own page. */
  showCompany?: boolean;
};

export function JobsTable({ jobs, now, showCompany = true }: JobsTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow>
            {showCompany && <TableHead className="px-3">Company</TableHead>}
            <TableHead className="px-3">Role</TableHead>
            <TableHead className="px-3">Location</TableHead>
            <TableHead className="px-3">Mode</TableHead>
            <TableHead className="px-3">Posted</TableHead>
            <TableHead className="px-3">Source</TableHead>
            <TableHead className="px-3">
              <span className="sr-only">Job post</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              {showCompany && (
                <TableCell className="max-w-56 px-3 font-medium whitespace-normal">
                  <Link href={`/companies/${encodeURIComponent(job.company.id)}`} className="hover:underline">
                    {job.company.name}
                  </Link>
                </TableCell>
              )}
              <TableCell className="min-w-56 px-3 whitespace-normal">{job.title}</TableCell>
              <TableCell className="max-w-56 truncate px-3 text-muted-foreground">
                {jobLocation(job)}
              </TableCell>
              <TableCell className="px-3">
                <WorkModeBadge workMode={job.workMode} />
              </TableCell>
              <TableCell className="px-3 text-muted-foreground">
                <RelativeTime iso={job.postedAt} now={now} />
              </TableCell>
              <TableCell className="px-3">
                <SourceBadge source={job.source} />
              </TableCell>
              <TableCell className="px-3 text-right">
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Open job
                  <ArrowUpRightIcon aria-hidden data-icon="inline-end" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function jobLocation(job: JobItem): string {
  if (job.location) return job.location;
  if (job.country) return COUNTRY_LABELS[job.country];
  return "–";
}
