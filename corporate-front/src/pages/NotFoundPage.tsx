import { Link } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        title="Pagina no encontrada"
        description="La direccion a la que intento acceder no existe."
        action={
          <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
            Volver al panel principal
          </Link>
        }
      />
    </div>
  );
}
