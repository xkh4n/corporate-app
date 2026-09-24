import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { SidebarMenu } from "../components/SidebarMenu";
import { NotificationBell } from "../components/NotificationBell";
import logo from "../assets/imperial_white.png";

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { menu } = useAuth();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;

  return (
    <aside
      className={`fixed left-0 top-16 bottom-0 z-30 w-64 shrink-0 border-r border-slate-200 bg-blue-950
        transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <nav className="h-full space-y-0.5 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-color:#475569_transparent] scrollbar-thin">
        <NavLink to="/" end onClick={onNavigate} className={linkClass}>
          Panel principal
        </NavLink>
        <SidebarMenu nodes={menu} onNavigate={onNavigate} />
      </nav>
    </aside>
  );
}

function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();

  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b border-slate-200 bg-blue-950 px-4">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu"
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <img src={logo} alt="Imperial" className="h-7 w-auto shrink-0" />
      <p className="truncate text-2xl font-medium text-gray-00 text-zinc-200">
        Hola: {user?.firstName} {user?.lastName}
      </p>
      <div className="ml-auto flex items-center gap-3">
        <NotificationBell />
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-100 hover:text-gray-700 hover:bg-red-500"
        >
          Cerrar sesion
        </button>
      </div>
    </header>
  );
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-sky-100">
      <Topbar onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}
      <main className="mt-2 ml-4 p-6 pt-16 lg:pl-64">
        <Outlet />
      </main>
    </div>
  );
}
