import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { SidebarMenu } from "../components/SidebarMenu";
import { NotificationBell } from "../components/NotificationBell";
import { IoLogOutOutline } from "react-icons/io5";
import logo from "../assets/imperial_white.png";

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { menu } = useAuth();

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? "bg-brand-50 text-brand-800" : "text-slate-200 hover:bg-red-500"
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
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-2 border-b border-slate-200 bg-blue-950 px-2 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu"
        className="shrink-0 rounded-md p-2 text-zinc-100 hover:bg-white/10 lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <img src={logo} alt="Imperial" className="h-5 w-auto min-w-0 shrink sm:h-7" />
      {/* El saludo no cabe junto al logo y las acciones en telefono. */}
      <p className="hidden min-w-0 truncate text-lg font-medium text-zinc-200 md:block lg:text-2xl">
        Hola: {user?.firstName} {user?.lastName}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
        <NotificationBell />
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Cerrar sesion"
          className="flex items-center gap-1.5 rounded-md p-2 text-sm font-medium text-zinc-100 hover:bg-red-500 sm:px-3 sm:py-1.5"
        >
          <IoLogOutOutline className="h-6 w-6 sm:hidden" aria-hidden />
          <span className="hidden sm:inline">Cerrar sesion</span>
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
      {/* Margen simetrico y chico en telefono; en escritorio se corre el ancho del sidebar fijo. */}
      <main className="min-w-0 px-3 pb-6 pt-20 sm:px-6 lg:ml-64 lg:pt-22">
        <Outlet />
      </main>
    </div>
  );
}
