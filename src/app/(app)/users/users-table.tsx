"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { createUserAction, setUserActiveAction, setUserRoleAction } from "@/server/actions/users";

type User = { id: string; email: string; fullName: string; role: "admin" | "staff"; isActive: boolean };

export function UsersTable({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: { message: string } }>, done: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error?.message ?? "Something went wrong");
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

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
              <TableHead>Role</TableHead>
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
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
                    {u.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Turned off</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <AddUserDialog open={adding} onOpenChange={setAdding} onCreated={() => router.refresh()} />
    </>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const [values, setValues] = useState({ fullName: "", email: "", role: "staff" as "staff" | "admin", password: "" });
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
      setValues({ fullName: "", email: "", role: "staff", password: "" });
      onOpenChange(false);
      onCreated();
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
