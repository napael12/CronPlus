import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary
        fallback={(error, reset) => (
          <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-lg font-semibold">Something went wrong</p>
            <p className="max-w-md text-sm text-muted-foreground">{error.message}</p>
            <button
              onClick={() => {
                reset();
                window.location.reload();
              }}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Reload
            </button>
          </div>
        )}
      >
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
