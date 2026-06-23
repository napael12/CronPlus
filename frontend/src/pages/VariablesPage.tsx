import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Variable as VariableIcon } from "lucide-react";
import api, { Variable, PaginatedResponse, getApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";

function VariableForm({
  initial,
  onSave,
}: {
  initial?: Partial<Variable>;
  onSave: (d: Partial<Variable>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [expression, setExpression] = useState(initial?.expression ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my_variable" />
        <p className="text-xs text-muted-foreground">Use in configs as {"{my_variable}"}</p>
      </div>
      <div className="space-y-1">
        <Label>Expression</Label>
        <Textarea
          value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder='Plain value or Python expression, e.g. datetime.datetime.now().strftime("%Y%m%d")'
          rows={3}
        />
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <Button onClick={() => onSave({ name, expression, description })} className="w-full">
        Save
      </Button>
    </div>
  );
}

export function VariablesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const canEdit = user?.role === "admin";
  const [editTarget, setEditTarget] = useState<Variable | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["variables", page],
    queryFn: () => api.get<PaginatedResponse<Variable>>(`/variables/?page=${page}`).then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (d: Partial<Variable>) =>
      editTarget
        ? api.patch(`/variables/${editTarget.id}/`, d)
        : api.post("/variables/", d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variables"] });
      setPage(1);
      setDialogOpen(false);
      setEditTarget(null);
      addToast(editTarget ? "Variable updated" : "Variable created", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/variables/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["variables"] });
      setPage(1);
      addToast("Variable deleted", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><VariableIcon className="h-6 w-6" />Variables</h1>
        {canEdit && (
          <Button
            size="sm"
            onClick={() => { setEditTarget(null); setDialogOpen(true); }}
          >
            <Plus className="h-4 w-4 mr-1" />New Variable
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Expression</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
              <th className="px-4 py-2 text-left font-medium">Updated</th>
              {canEdit && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody>
            {data?.results?.map((v) => (
              <tr key={v.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-2 font-mono text-xs font-medium">{"{" + v.name + "}"}</td>
                <td className="px-4 py-2 font-mono text-xs max-w-xs truncate">{v.expression}</td>
                <td className="px-4 py-2 text-muted-foreground">{v.description}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {new Date(v.updated_at).toLocaleString()}
                </td>
                {canEdit && (
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => { setEditTarget(v); setDialogOpen(true); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => { if (confirm("Delete variable?")) del.mutate(v.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {data?.results?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  No variables defined
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} count={data?.count ?? 0} pageSize={10} onChange={setPage} />
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Variable" : "New Variable"}</DialogTitle>
          </DialogHeader>
          <VariableForm
            initial={editTarget ?? undefined}
            onSave={(d) => save.mutate(d)}
          />
          {save.isError && (
            <p className="text-sm text-destructive mt-1">{getApiError(save.error)}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
