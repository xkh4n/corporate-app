import { Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { ModulePlaceholder } from "../pages/ModulePlaceholder";
import { ForbiddenPage } from "../pages/ForbiddenPage";
import { flattenMenuLinks } from "../lib/menu";

// Fuente unica de las rutas de modulo: el menu del usuario autenticado (ya
// podado por permisos, ver getMenuTreeForRole en corporate-api), no un
// archivo estatico. Lo que no esta en tu menu no existe para vos -el
// catch-all cae en ForbiddenPage, no en un 404: no hay forma de distinguir
// "no existe" de "existe pero no lo ves" sin filtrar informacion del
// catalogo completo a alguien sin permiso.
export function AppRoutes() {
  const { menu } = useAuth();
  const moduleLinks = flattenMenuLinks(menu);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/403" element={<ForbiddenPage />} />

          {moduleLinks.map((item) => (
            <Route key={item.link} path={item.link} element={<ModulePlaceholder title={item.label} />} />
          ))}

          <Route path="*" element={<ForbiddenPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
