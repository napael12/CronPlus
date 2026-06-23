import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { HelpCircle, Pencil, Settings } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/contexts/ToastContext";

interface AppSetting {
  id: number;
  key: string;
  label: string;
  value: string;
  description: string;
}

const SECRET_KEYS = new Set(["notification_mailhost_password"]);

export function SettingsPage() {
  const { addToast } = useToast();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<{ results: AppSetting[] }>("/settings/").then((r) => r.data.results),
  });

  const [editTarget, setEditTarget] = useState<AppSetting | null>(null);
  const [editValue, setEditValue] = useState("");

  const openEdit = (s: AppSetting) => {
    setEditTarget(s);
    setEditValue(s.value);
  };

  const closeEdit = () => {
    setEditTarget(null);
    setEditValue("");
  };

  const save = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) =>
      api.patch(`/settings/${id}/`, { value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      addToast("Setting saved", "success");
      closeEdit();
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6" />Settings</h1>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Setting</th>
              <th className="px-4 py-2.5 text-left font-medium">Value</th>
              <th className="px-4 py-2.5 w-10" />
            </tr>
          </thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{s.label || s.key}</span>
                    {s.description && (
                      <span title={s.description} className="cursor-help text-muted-foreground">
                        <HelpCircle className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                  {SECRET_KEYS.has(s.key) && s.value ? "••••••••" : s.value}
                </td>
                <td className="px-4 py-3">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                  No settings configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={editTarget != null} onOpenChange={(open) => { if (!open) closeEdit(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Setting</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <p className="text-sm font-medium">{editTarget?.label || editTarget?.key}</p>
              {editTarget?.description && (
                <p className="text-xs text-muted-foreground mt-0.5">{editTarget.description}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Value</Label>
              <Input
                type={editTarget && SECRET_KEYS.has(editTarget.key) ? "password" : "text"}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editTarget) save.mutate({ id: editTarget.id, value: editValue });
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>Cancel</Button>
            <Button
              onClick={() => { if (editTarget) save.mutate({ id: editTarget.id, value: editValue }); }}
              disabled={save.isPending}
            >
              Ok
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
