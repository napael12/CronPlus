import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { VariablesPage } from "@/pages/VariablesPage";
import { RunDetailPage } from "@/pages/RunDetailPage";
import { UsersPage } from "@/pages/UsersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AuditPage } from "@/pages/AuditPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdminOrOperator({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin" && user?.role !== "operator") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="variables" element={<VariablesPage />} />
        <Route path="runs/:id" element={<RunDetailPage />} />
        <Route path="audit" element={<RequireAdminOrOperator><AuditPage /></RequireAdminOrOperator>} />
        <Route path="users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
        <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
