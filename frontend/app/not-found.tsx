import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col px-4 py-6 sm:py-8">
      <EmptyState
        title="Page not found"
        description="This link does not lead anywhere in OpenRoles."
        action={{ href: "/", label: "Go to hiring companies" }}
      />
    </main>
  );
}
