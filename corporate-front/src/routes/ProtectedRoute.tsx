import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Spinner } from "../components/ui/Spinner";

// Exige sesion. No exige un permiso puntual: el menu que devuelve la API ya
// viene podado por permisos (ver AppRoutes), asi que las rutas de modulo se
// generan solo para lo que el usuario puede ver.
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (status === "anonymous") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
