import { ArrowLeftIcon, ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { JobsTable } from "@/components/jobs-table";
import { CompanySkeleton } from "@/components/skeletons";
import { SourceBadge } from "@/components/source-badge";
import { ApiError, getCompanyJobs } from "@/lib/api";
import { formatRelative, plural } from "@/lib/format";
import { requestNow } from "@/lib/now";

type Props = PageProps<"/companies/[id]">;

export default function CompanyPage({ params }: Props) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Hiring companies
      </Link>
      <Suspense fallback={<CompanySkeleton />}>
        <CompanyDetails params={params} />
      </Suspense>
    </main>
  );
}

async function CompanyDetails({ params }: Pick<Props, "params">) {
  const { id } = await params;
  const [{ company, jobs }, now] = await Promise.all([loadCompany(id), requestNow()]);

  const facts = [
    plural(company.openRoles, "open role", "open roles"),
    `${company.newToday} new today`,
    company.latestPostedAt && `latest post ${formatRelative(company.latestPostedAt, now)}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          {company.linkedinUrl && (
            <a
              href={company.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
            >
              LinkedIn
              <ArrowUpRightIcon aria-hidden className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <span>{facts.join(" · ")}</span>
          {company.sources.length > 0 && (
            <span className="flex gap-1">
              {company.sources.map((source) => (
                <SourceBadge key={source} source={source} />
              ))}
            </span>
          )}
        </div>
      </header>
      {jobs.length > 0 ? (
        <JobsTable jobs={jobs} now={now} showCompany={false} />
      ) : (
        <EmptyState
          title="No open roles right now"
          description="This company has no open roles in India, the UAE or the US at the moment."
        />
      )}
    </div>
  );
}

async function loadCompany(id: string) {
  try {
    return await getCompanyJobs(id);
  } catch (error) {
    // 404: unknown company. 400: an id the API rejects. Both mean "no such company".
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
}
