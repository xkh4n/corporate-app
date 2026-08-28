import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { NotificationsProvider } from "./notifications/NotificationsContext";
import { AppRoutes } from "./routes/AppRoutes";
import { Toast } from "./components/Toast";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Dentro de AuthProvider: lee useAuth().status para saber cuando
        conectar/desconectar el socket (ver NotificationsContext.tsx). */}
        <NotificationsProvider>
          {/* Un solo ToastContainer para toda la app -las paginas solo llaman
          showXToast(...), nunca montan su propio <Toast/> (evitaria
          notificaciones duplicadas). */}
          <Toast />
          <AppRoutes />
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
