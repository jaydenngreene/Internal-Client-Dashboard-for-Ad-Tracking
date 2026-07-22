"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { login, register } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agencyName, setAgencyName] = useState("");

  const mutation = useMutation({
    mutationFn: () => (mode === "login" ? login(email, password) : register(email, password, agencyName)),
    onSuccess: (result) => {
      setToken(result.token);
      router.replace("/agency");
    },
  });

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm px-4">
        <CardHeader className="px-0">
          <CardTitle>{mode === "login" ? "Log in" : "Create an account"}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mode === "register" && (
              <div className="flex flex-col gap-1">
                <FieldLabel>Agency name</FieldLabel>
                <Input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} placeholder="e.g. Greene Consulting Group" required />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <FieldLabel>Email</FieldLabel>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel>Password</FieldLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === "register" ? 8 : undefined}
                required
              />
              {mode === "register" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
            </div>
            {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Need an account? Create one" : "Already have an account? Log in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
