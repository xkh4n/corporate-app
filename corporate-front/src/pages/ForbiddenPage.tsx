import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        title="Acceso restringido"
        description="Su rol no tiene permiso para ver esta seccion."
        action={
          <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
            Volver al panel principal
          </Link>
        }
      />
    </div>
  );
}
