import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: { href: string; label: string };
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && (
        <Link
          href={action.href}
          scroll={false}
          className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
