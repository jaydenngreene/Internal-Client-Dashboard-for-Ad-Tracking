import { Card } from "@/components/ui/card";

// Every logged-out screen (login, password reset, email verification) shares this
// shell. Previously each page hand-rolled `<div className="flex h-full items-center
// justify-center ...">`, which relied on a percentage-height chain through
// AppShell's Fragment passthrough → body → html — that chain doesn't reliably
// resolve to a real height in every browser layout context, and in practice the
// card rendered pinned to the top-left of the viewport instead of centered.
// `fixed inset-0` sidesteps the whole chain: it's sized directly off the viewport,
// no ancestor height required.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-background px-6 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-70"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--chart-3) 18%, transparent), transparent 70%), " +
            "radial-gradient(45% 40% at 85% 90%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl ring-1 ring-primary/20">
            <img src="/kado-logo.png" alt="Kado" className="size-full object-cover" />
          </span>
          <span className="text-base font-semibold tracking-tight text-foreground">Kado</span>
        </div>
        <Card className="w-full px-5 py-1 shadow-2xl shadow-black/40 ring-1 ring-border">{children}</Card>
      </div>
    </div>
  );
}
