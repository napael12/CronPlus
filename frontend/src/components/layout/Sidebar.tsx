import { useState } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Variable, Users, Settings, LogOut, Clock, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

const navItems = [
  { to: "/projects", icon: FolderKanban, label: "Projects" },
  { to: "/", icon: LayoutDashboard, label: "Monitor", exact: true },
  { to: "/variables", icon: Variable, label: "Variables" },
];

const adminOnlyItems = [
  { to: "/users", icon: Users, label: "Users" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");

  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem("sidebar-collapsed", String(!c));
      return !c;
    });

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center rounded-md py-2 text-sm transition-colors hover:bg-accent",
      collapsed ? "justify-center px-2" : "gap-3 px-3",
      isActive && "bg-accent font-medium"
    );

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-card transition-[width] duration-200 overflow-hidden",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* Logo + toggle */}
      <div className="flex h-14 shrink-0 items-center border-b px-3 gap-2">
        <Clock className="h-5 w-5 text-primary shrink-0" />
        {!collapsed && <span className="font-bold text-lg flex-1 truncate">CronPlus</span>}
        <button
          onClick={toggle}
          className="rounded p-1 hover:bg-accent shrink-0"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 p-2 flex-1">
        {navItems.map(({ to, icon: Icon, label, exact }) => (
          <NavLink key={to} to={to} end={exact} title={collapsed ? label : undefined} className={linkClass}>
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}

        {(user?.role === "admin" || user?.role === "operator") && (
          <>
            {collapsed
              ? <div className="mt-3 mb-1 border-t border-border" />
              : <div className="mt-4 mb-1 px-3 text-xs font-semibold text-muted-foreground uppercase">Admin</div>
            }
            <NavLink to="/audit" title={collapsed ? "Audit" : undefined} className={linkClass}>
              <ClipboardList className="h-4 w-4 shrink-0" />
              {!collapsed && "Audit"}
            </NavLink>
            {user?.role === "admin" && adminOnlyItems.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} title={collapsed ? label : undefined} className={linkClass}>
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      {/* User footer */}
      <div className="shrink-0 border-t p-3">
        {collapsed ? (
          <button
            onClick={logout}
            className="flex w-full justify-center rounded p-1 hover:bg-accent"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name || user?.email}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.role}</p>
            </div>
            <button onClick={logout} className="ml-2 rounded p-1 hover:bg-accent" title="Logout">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
