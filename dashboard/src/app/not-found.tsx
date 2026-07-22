import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <p className="text-lg font-medium text-foreground">Page not found</p>
      <p className="text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link
        href="/agency"
        className="mt-2 inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
      >
        Back to Agency Overview
      </Link>
    </div>
  );
}
