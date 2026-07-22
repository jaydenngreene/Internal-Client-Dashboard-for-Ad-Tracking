"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { login, forgotPassword, verifyMfaCode } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const mutation = useMutation({ mutationFn: () => forgotPassword(email) });

  if (mutation.isSuccess) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground">If an account exists for that email, a reset link has been sent.</p>
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={onBack}>
          Back to log in
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="flex flex-col gap-1">
        <FieldLabel>Email</FieldLabel>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Sending…" : "Send reset link"}
      </Button>
      <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={onBack}>
        Back to log in
      </button>
    </form>
  );
}

// Step 55 — the second step of login when the account has 2FA enabled. Accepts
// either a 6-digit app code or a backup code in the same field.
function MfaForm({ mfaToken, onBack }: { mfaToken: string; onBack: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");

  const mutation = useMutation({
    mutationFn: () => verifyMfaCode(mfaToken, code.trim()),
    onSuccess: (result) => {
      setToken(result.token);
      router.replace("/agency");
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app, or a backup code.</p>
      <div className="flex flex-col gap-1">
        <FieldLabel>Code</FieldLabel>
        <Input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
      </div>
      {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
      <Button type="submit" disabled={mutation.isPending || !code.trim()}>
        {mutation.isPending ? "Verifying…" : "Verify"}
      </Button>
      <button type="button" className="text-xs text-muted-foreground underline underline-offset-2" onClick={onBack}>
        Back to log in
      </button>
    </form>
  );
}

// No "Create Account" path here anymore — logins are created only via
// `npm run create:user`, run by whoever administers this deployment. Someone
// landing on this page with no account of their own has no way to make one.
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "forgot" | "mfa">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (result) => {
      if ("mfaRequired" in result) {
        setMfaToken(result.mfaToken);
        setMode("mfa");
        return;
      }
      setToken(result.token);
      router.replace("/agency");
    },
  });

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm px-4">
        <CardHeader className="px-0">
          <CardTitle>
            {mode === "login" ? "Log in" : mode === "mfa" ? "Verify your identity" : "Reset your password"}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {mode === "mfa" && mfaToken ? (
            <MfaForm mfaToken={mfaToken} onBack={() => setMode("login")} />
          ) : mode === "forgot" ? (
            <ForgotPasswordForm onBack={() => setMode("login")} />
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel>Password</FieldLabel>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Please wait…" : "Log in"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted-foreground underline underline-offset-2"
                onClick={() => setMode("forgot")}
              >
                Forgot password?
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
