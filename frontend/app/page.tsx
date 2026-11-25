import { Suspense } from "react";

import { SalesPage } from "@/components/sales-page";
import { SalesPageSkeleton } from "@/components/skeletons";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Hiring companies</h1>
        <p className="text-sm text-muted-foreground">
          Who is hiring in India, the UAE and the US, with a link to each live job post.
        </p>
      </header>
      {/* The header is static; the rest depends on the URL and streams in. */}
      <Suspense fallback={<SalesPageSkeleton />}>
        <SalesPage searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
