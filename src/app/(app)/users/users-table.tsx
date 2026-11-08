"use client";

import { KeyRound, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUserAction,
  setCanGetEmailsAction,
  setUserActiveAction,
  setUserPasswordAction,
  setUserRoleAction,
} from "@/server/actions/users";

type User = {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "staff";
  isActive: boolean;
  canGetEmails: boolean;
};

const EMAIL_TICK_HINT = "Only when this email is read by this person alone. Lets them reset a forgotten password by email.";

export function UsersTable({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [settingPassword, setSettingPassword] = useState<User | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message ?? "Something went wrong");
        return;
      }
      toast.success(done);
    });
  }

  const roleSelect = (u: User) => (
    <NativeSelect
      aria-label={`Role for ${u.fullName}`}
      size="sm"
      value={u.role}
      disabled={pending}
      onChange={(e) =>
        run(() => setUserRoleAction(u.id, e.target.value as User["role"]), `${u.fullName} is now ${e.target.value}`)
      }
    >
      <NativeSelectOption value="staff">Staff</NativeSelectOption>
      <NativeSelectOption value="admin">Admin</NativeSelectOption>
    </NativeSelect>
  );

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setAdding(true)}>
          <UserPlus /> Add user
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const self = u.id === currentUserId;
              return (
                <TableRow key={u.id} className={u.isActive ? "" : "text-muted-foreground"}>
                  <TableCell>
                    <div className="font-medium">
                      {u.fullName}
                      {self && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    <div className="mt-2 sm:hidden">{roleSelect(u)}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{roleSelect(u)}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-2">
                      {u.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Turned off</Badge>}
                      <label className="flex items-center gap-2 text-xs whitespace-normal" title={EMAIL_TICK_HINT}>
                        <Checkbox
                          checked={u.canGetEmails}
                          disabled={pending}
                          aria-label={`${u.fullName} can get emails`}
                          onCheckedChange={(c) =>
                            run(
                              () => setCanGetEmailsAction(u.id, Boolean(c)),
                              c ? `${u.fullName} can reset their password by email` : `${u.fullName} can no longer reset by email`,
                            )
                          }
                        />
                        Can get emails
                      </label>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-end gap-1 sm:flex-row sm:justify-end">
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setSettingPassword(u)}>
                        <KeyRound aria-hidden />
                        <span className="sr-only sm:not-sr-only">Set password</span>
                        <span aria-hidden className="sm:hidden">Password</span>
                      </Button>
                      {!self && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setUserActiveAction(u.id, !u.isActive),
                              u.isActive ? `${u.fullName} can no longer sign in` : `${u.fullName} can sign in again`,
                            )
                          }
                        >
                          {u.isActive ? "Turn off" : "Turn on"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <AddUserDialog open={adding} onOpenChange={setAdding} />
      <SetPasswordDialog
        user={settingPassword}
        self={settingPassword?.id === currentUserId}
        onClose={() => setSettingPassword(null)}
        // setUserPasswordAction revalidates nothing; the refresh sends an admin who changed their own
        // password to sign-in. Never pair router.refresh() with an action that calls revalidatePath.
        onDone={() => router.refresh()}
      />
    </>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const empty = { fullName: "", email: "", role: "staff" as "staff" | "admin", password: "", canGetEmails: false };
  const [values, setValues] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createUserAction(values);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(`${values.fullName} can now sign in`);
      setValues(empty);
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Give them the email and password so they can sign in.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="u-name">Name</Label>
            <Input id="u-name" required autoFocus value={values.fullName} onChange={(e) => setValues((v) => ({ ...v, fullName: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" required value={values.email} onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="u-role">Role</Label>
            <NativeSelect id="u-role" className="w-full" value={values.role} onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as "staff" | "admin" }))}>
              <NativeSelectOption value="staff">Staff</NativeSelectOption>
              <NativeSelectOption value="admin">Admin</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="u-password">Password</Label>
            <Input
              id="u-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          <div className="grid gap-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={values.canGetEmails}
                onCheckedChange={(c) => setValues((v) => ({ ...v, canGetEmails: Boolean(c) }))}
              />
              Can get emails
            </label>
            <p className="text-xs text-muted-foreground">{EMAIL_TICK_HINT}</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({
  user,
  self,
  onClose,
  onDone,
}: {
  user: User | null;
  self: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setPassword("");
    setError(null);
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    startTransition(async () => {
      const result = await setUserPasswordAction(user.id, password);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      toast.success(self ? "Password changed. Sign in again." : `New password set for ${user.fullName}`);
      close();
      onDone();
    });
  }

  return (
    <Dialog open={user !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Set password{user && !self ? ` for ${user.fullName}` : ""}</DialogTitle>
            <DialogDescription>
              {self
                ? "You'll be signed out on every device, then sign in with the new password."
                : "They're signed out on every device. Give them the new password so they can sign in."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="sp-password">New password</Label>
            <Input
              id="sp-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
