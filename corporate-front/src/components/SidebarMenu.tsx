import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IoChevronDownOutline, IoChevronForwardOutline } from "react-icons/io5";
import type { MenuNode } from "../types/menu";
import { MenuIcon } from "./MenuIcon";

const INDENT_PX_PER_DEPTH = 12;

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-md py-2 pr-3 text-sm font-medium transition-colors ${
    isActive ? "bg-brand-50 text-brand-800" : "text-slate-200 hover:bg-slate-100 hover:text-zinc-700"
  }`;

// True si pathname es el link del nodo o el de algun descendiente. Un grupo
// se considera "en la rama activa" cuando esto da true para el; se usa tanto
// para decidir el estado inicial de open como para resincronizar en cada
// navegacion.
function containsPath(node: MenuNode, pathname: string): boolean {
  if (node.link === pathname) return true;
  return node.children.some((child) => containsPath(child, pathname));
}

// Nodo con hijos: grupo colapsable tipo "acordeon de ruta activa" (patron
// estandar en dashboards admin: AdminLTE, Ant Design Pro, etc). Abierto solo
// si la ruta activa cuelga de el; el resto arranca cerrado. El usuario puede
// togglear cualquier grupo a mano para explorar, pero al navegar (cambia
// location.pathname) se resincroniza SIEMPRE con la rama activa -incluyendo
// forzar el cierre de grupos que el usuario haya abierto manualmente y hayan
// quedado fuera de la nueva ruta. Se eligio "resync duro" en vez de "dejar lo
// que el usuario abrio" porque es el comportamiento menos sorpresivo: evita
// que el sidebar acumule ramas abiertas sin relacion con donde estas parado
// (justo el bug reportado: Productos y System Admin expandidos mientras se
// edita una Categoria).
function MenuGroup({
  node,
  depth,
  onNavigate,
}: {
  node: MenuNode;
  depth: number;
  onNavigate: () => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(() => containsPath(node, location.pathname));

  useEffect(() => {
    setOpen(containsPath(node, location.pathname));
  }, [node, location.pathname]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{ paddingLeft: 12 + depth * INDENT_PX_PER_DEPTH }}
        className="flex w-full items-center gap-2 rounded-md py-2 pr-3 text-left text-sm font-medium text-slate-200 hover:bg-red-500"
      >
        <MenuIcon name={node.icon} className="h-4 w-4 shrink-0 text-slate-100" />
        <span className="flex-1 truncate">{node.label}</span>
        {open ? (
          <IoChevronDownOutline className="h-3.5 w-3.5 shrink-0 text-slate-100" />
        ) : (
          <IoChevronForwardOutline className="h-3.5 w-3.5 shrink-0 text-slate-100" />
        )}
      </button>
      {open && (
        <div className="space-y-0.5">
          <SidebarMenu nodes={node.children} depth={depth + 1} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  );
}

// Render recursivo del arbol que devuelve GET /auth/menu (ya podado por
// permisos, ver corporate-api). Sin limite de profundidad: un nodo con hijos
// es un grupo, un nodo hoja con "link" es una ruta navegable, un nodo sin
// hijos ni link es una etiqueta plana (catalogo incompleto: existe pero
// todavia no apunta a nada).
export function SidebarMenu({
  nodes,
  depth = 0,
  onNavigate,
}: {
  nodes: MenuNode[];
  depth?: number;
  onNavigate: () => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.children.length > 0) {
          return <MenuGroup key={node.id} node={node} depth={depth} onNavigate={onNavigate} />;
        }

        if (node.link) {
          return (
            <NavLink
              key={node.id}
              to={node.link}
              onClick={onNavigate}
              style={{ paddingLeft: 12 + depth * INDENT_PX_PER_DEPTH }}
              className={linkClass}
            >
              <MenuIcon name={node.icon} className="h-4 w-4 shrink-0 text-slate-100" />
              <span className="truncate">{node.label}</span>
            </NavLink>
          );
        }

        return (
          <div
            key={node.id}
            style={{ paddingLeft: 12 + depth * INDENT_PX_PER_DEPTH }}
            className="flex items-center gap-2 py-2 pr-3 text-sm text-slate-100"
          >
            <MenuIcon name={node.icon} className="h-4 w-4 shrink-0" />
            <span className="truncate">{node.label}</span>
          </div>
        );
      })}
    </>
  );
}
