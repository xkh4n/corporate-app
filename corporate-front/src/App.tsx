import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { PermissionRoute } from "./routes/PermissionRoute";
import { AppLayout } from "./layouts/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ModulePlaceholder } from "./pages/ModulePlaceholder";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ALL_NAV_ITEMS } from "./config/navigation";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/403" element={<ForbiddenPage />} />

              {ALL_NAV_ITEMS.map((item) =>
                item.permission ? (
                  <Route key={item.path} element={<PermissionRoute permission={item.permission} />}>
                    <Route path={item.path} element={<ModulePlaceholder title={item.label} />} />
                  </Route>
                ) : (
                  <Route key={item.path} path={item.path} element={<ModulePlaceholder title={item.label} />} />
                ),
              )}

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
