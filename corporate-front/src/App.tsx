import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { AppRoutes } from "./routes/AppRoutes";
import { Toast } from "./components/Toast";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* Un solo ToastContainer para toda la app -las paginas solo llaman
        showXToast(...), nunca montan su propio <Toast/> (evitaria
        notificaciones duplicadas). */}
        <Toast />
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
