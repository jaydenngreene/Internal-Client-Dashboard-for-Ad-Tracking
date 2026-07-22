"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMe, updateMe, updatePassword, deleteAccount } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field-label";
import { Skeleton } from "@/components/ui/skeleton";

function ProfileSection({ agencyName, email }: { agencyName: string; email: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(agencyName);
  const [newEmail, setNewEmail] = useState(email);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["me"] });

  const nameMutation = useMutation({
    mutationFn: () => updateMe({ agency_name: name.trim() }),
    onSuccess: invalidate,
  });
  const emailMutation = useMutation({
    mutationFn: () => updateMe({ email: newEmail.trim() }),
    onSuccess: invalidate,
  });

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Agency name</FieldLabel>
            <Input className="w-64" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button size="sm" disabled={!name.trim() || name.trim() === agencyName || nameMutation.isPending} onClick={() => nameMutation.mutate()}>
            Save
          </Button>
        </div>
        {nameMutation.isError && <p className="text-xs text-status-critical">{(nameMutation.error as Error).message}</p>}

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Email</FieldLabel>
            <Input className="w-64" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <Button size="sm" disabled={!newEmail.trim() || newEmail.trim() === email || emailMutation.isPending} onClick={() => emailMutation.mutate()}>
            Save
          </Button>
        </div>
        {emailMutation.isError && <p className="text-xs text-status-critical">{(emailMutation.error as Error).message}</p>}
      </CardContent>
    </Card>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const mutation = useMutation({
    mutationFn: () => updatePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
  });

  const mismatch = newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Password</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <div className="flex flex-col gap-1">
          <FieldLabel>Current password</FieldLabel>
          <Input className="w-64" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>New password</FieldLabel>
          <Input className="w-64" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>Confirm new password</FieldLabel>
          <Input className="w-64" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
        {mismatch && <p className="text-xs text-status-critical">Passwords don&apos;t match.</p>}
        {mutation.isError && <p className="text-xs text-status-critical">{(mutation.error as Error).message}</p>}
        {mutation.isSuccess && <p className="text-xs text-status-good">Password updated.</p>}
        <div>
          <Button
            size="sm"
            disabled={!currentPassword || !newPassword || newPassword.length < 8 || mismatch || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Update password
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionSection() {
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <Card className="px-4">
      <CardHeader className="px-0">
        <CardTitle>Session</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">Sign out of this device.</p>
        <div>
          <Button size="sm" variant="outline" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DangerZoneSection({ email }: { email: string }) {
  const [confirmText, setConfirmText] = useState("");
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: () => deleteAccount(),
    onSuccess: () => {
      clearToken();
      router.replace("/login");
    },
  });

  return (
    <Card className="border-status-critical/40 px-4">
      <CardHeader className="px-0">
        <CardTitle className="text-status-critical">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        <p className="text-xs text-muted-foreground">
          Permanently deletes your account and every client you own, along with all their data. This cannot be
          undone. Type <span className="font-medium text-foreground">{email}</span> to confirm.
        </p>
        <Input className="w-64" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={email} />
        {mutation.isError && <p className="text-xs text-status-critical">Failed to delete account.</p>}
        <div>
          <Button
            variant="destructive"
            size="sm"
            disabled={confirmText !== email || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Deleting…" : "Delete my account"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AccountClient() {
  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Account Settings</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Your own login and agency profile — separate from any individual client&apos;s settings.
        </p>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}
      {me && (
        <>
          <ProfileSection agencyName={me.agency_name} email={me.email} />
          <PasswordSection />
          <SessionSection />
          <DangerZoneSection email={me.email} />
        </>
      )}
    </div>
  );
}
