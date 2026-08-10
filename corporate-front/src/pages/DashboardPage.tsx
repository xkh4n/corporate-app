import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ALL_NAV_ITEMS } from "../config/navigation";

export function DashboardPage() {
  const { user, can } = useAuth();
  const shortcuts = ALL_NAV_ITEMS.filter((item) => !item.permission || can(item.permission));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Hola, {user?.username}</h1>
        <p className="text-sm text-slate-500">Rol: {user?.roleName}</p>
      </div>

      {shortcuts.length === 0 ? (
        <p className="text-sm text-slate-500">
          Su rol todavia no tiene modulos asignados. Contacte a un administrador.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="rounded-lg border border-slate-200 bg-white p-4 text-sm font-medium text-slate-700
                shadow-sm transition-colors hover:border-brand-300 hover:text-brand-800"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
