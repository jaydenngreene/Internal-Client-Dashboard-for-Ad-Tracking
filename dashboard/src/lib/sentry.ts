import * as Sentry from "@sentry/browser";

// Same disclosure pattern as every other integration: without
// NEXT_PUBLIC_SENTRY_DSN, this never initializes and captureError() below is a
// no-op. Uses @sentry/browser directly (not @sentry/nextjs) to avoid that
// package's build-time webpack instrumentation on a framework version (Next 16)
// it may not yet fully support — this still reports real client-side errors
// once a DSN is set, just without server-side/edge tracing.
let initialized = false;

function ensureInit() {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0.1 });
  initialized = true;
}

export function captureError(error: unknown): void {
  ensureInit();
  if (!initialized) return;
  Sentry.captureException(error);
}
