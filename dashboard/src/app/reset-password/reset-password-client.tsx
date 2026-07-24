"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { resetPassword } from "@/lib/api";
import { AuthShell } from "@/components/auth-shell";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";

export function ResetPasswordClient() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => resetPassword(token, newPassword),
  });

  const mismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <AuthShell>
      <CardHeader className="px-0">
        <CardTitle className="text-lg">Set a new password</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-5">
        {!token ? (
            <p className="text-sm text-status-critical">This link is missing its reset token.</p>
          ) : mutation.isSuccess ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">Your password has been reset.</p>
              <Button onClick={() => router.replace("/login")}>Log in</Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <FieldLabel>New password</FieldLabel>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
                <p className="text-xs text-muted-foreground">At least 8 characters.</p>
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel>Confirm new password</FieldLabel>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              {mismatch && <p className="text-xs text-status-critical">Passwords don&apos;t match.</p>}
              {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
              <Button type="submit" disabled={!newPassword || newPassword.length < 8 || mismatch || mutation.isPending}>
                {mutation.isPending ? "Resetting…" : "Reset password"}
              </Button>
            </form>
          )}
      </CardContent>
    </AuthShell>
  );
}
