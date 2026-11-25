"use client"; // Error boundaries must be Client Components

import { RotateCwIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:py-8">
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Can&apos;t reach the OpenRoles API</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The job data could not be loaded. This is usually short-lived. Try again in a moment.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => retry()}>
          <RotateCwIcon data-icon="inline-start" />
          Try again
        </Button>
      </div>
    </main>
  );
}
