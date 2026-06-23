import React, { createContext, useCallback, useContext, useState } from "react";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";

export type ToastType = "error" | "success" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _nextId = 1;

const DURATION: Record<ToastType, number> = {
  error: 7000,
  success: 3000,
  info: 4000,
};

const STYLES: Record<ToastType, string> = {
  error: "bg-destructive text-destructive-foreground",
  success: "bg-green-600 text-white",
  info: "bg-primary text-primary-foreground",
};

const ICONS: Record<ToastType, React.ReactNode> = {
  error: <AlertCircle className="h-4 w-4 shrink-0" />,
  success: <CheckCircle className="h-4 w-4 shrink-0" />,
  info: <Info className="h-4 w-4 shrink-0" />,
};

function Toaster({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-md px-3 py-2.5 shadow-lg text-sm ${STYLES[t.type]}`}
        >
          {ICONS[t.type]}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => onRemove(t.id)}
            className="ml-1 opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = _nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => removeToast(id), DURATION[type]);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <Toaster toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
