import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import api, { User, PaginatedResponse, getApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/contexts/ToastContext";

function UserForm({
  initial,
  onSave,
}: {
  initial?: Partial<User> & { password?: string };
  onSave: (d: any) => void;
}) {
  const [email, setEmail] = useState(initial?.email ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState<string>(initial?.role ?? "read_only");
  const [password, setPassword] = useState("");
  const isEdit = !!initial?.id;
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Email</Label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isEdit} />
      </div>
      <div className="space-y-1">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Role</Label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        >
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="read_only">Read Only</option>
        </select>
      </div>
      {!isEdit && (
        <div className="space-y-1">
          <Label>Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      <Button onClick={() => onSave({ email, name, role, ...(password ? { password } : {}) })} className="w-full">
        Save
      </Button>
    </div>
  );
}

export function UsersPage() {
  const { addToast } = useToast();
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["users", page],
    queryFn: () => api.get<PaginatedResponse<User>>(`/users/?page=${page}`).then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (d: any) =>
      editTarget ? api.patch(`/users/${editTarget.id}/`, d) : api.post("/users/", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setDialogOpen(false);
      setEditTarget(null);
      addToast(editTarget ? "User updated" : "User created", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      addToast("User deleted", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const roleVariant: Record<string, any> = { admin: "default", operator: "secondary", read_only: "outline" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6" />Users</h1>
        <Button size="sm" onClick={() => { setEditTarget(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" />New User
        </Button>
      </div>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Email</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Active</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data?.results?.map((u) => (
              <tr key={u.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.name}</td>
                <td className="px-4 py-2">
                  <Badge variant={roleVariant[u.role]}>{u.role.replace("_", " ")}</Badge>
                </td>
                <td className="px-4 py-2">
                  <span className={u.is_active ? "text-green-600" : "text-muted-foreground"}>
                    {u.is_active ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => { setEditTarget(u); setDialogOpen(true); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete user?")) del.mutate(u.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} count={data?.count ?? 0} pageSize={10} onChange={setPage} />
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editTarget ? "Edit User" : "New User"}</DialogTitle></DialogHeader>
          <UserForm initial={editTarget ?? undefined} onSave={(d) => save.mutate(d)} />
          {save.isError && (
            <p className="text-sm text-destructive mt-1">{getApiError(save.error)}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
