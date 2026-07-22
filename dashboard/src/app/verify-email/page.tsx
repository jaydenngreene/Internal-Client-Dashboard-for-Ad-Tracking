"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { verifyEmail } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function VerifyEmailPage() {
  const token = useSearchParams().get("token") ?? "";
  const mutation = useMutation({ mutationFn: () => verifyEmail(token) });

  useEffect(() => {
    if (token) mutation.mutate();
    // Only ever run once per token — mutation identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm px-4">
        <CardHeader className="px-0">
          <CardTitle>Email verification</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {!token && <p className="text-sm text-status-critical">This link is missing its verification token.</p>}
          {token && mutation.isPending && <p className="text-sm text-muted-foreground">Verifying…</p>}
          {token && mutation.isSuccess && <p className="text-sm text-foreground">Your email is verified.</p>}
          {token && mutation.isError && (
            <p className="text-sm text-status-critical">{(mutation.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
