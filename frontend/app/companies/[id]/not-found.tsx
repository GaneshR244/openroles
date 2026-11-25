import { EmptyState } from "@/components/empty-state";

export default function CompanyNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:py-8">
      <EmptyState
        title="Company not found"
        description="It may have been removed, or the link is wrong."
        action={{ href: "/?mode=companies", label: "See all companies" }}
      />
    </main>
  );
}
