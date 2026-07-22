"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <p className="text-lg font-medium text-foreground">Something went wrong</p>
      <p className="max-w-md text-sm text-muted-foreground">
        This page hit an unexpected error. Try again, or go back to Agency Overview if it keeps happening.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
        <a
          href="/agency"
          className="inline-flex h-8 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
        >
          Back to Agency Overview
        </a>
      </div>
    </div>
  );
}
