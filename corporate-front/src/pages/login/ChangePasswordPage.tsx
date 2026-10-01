import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Alert } from "../../components/ui/Alert";
import { ChangePasswordForm } from "../../components/account/ChangePasswordForm";
import logo from "../../assets/imperial-logo.png";

// Pantalla obligatoria (ver MustChangePasswordGate en AppRoutes.tsx): se
// muestra en vez de cualquier otra ruta mientras user.mustChangePassword sea
// true -primer login con la password por defecto, o despues de un reset
// administrativo. El formulario es el mismo de "Seguridad de mi cuenta"
// (ChangePasswordForm, mismo PATCH /auth/change-password de autoservicio).
export function ChangePasswordPage() {
  const { user } = useAuth();

  // Sin esto: tras cambiar la password, ProtectedRoute manda a /login con
  // state.from="/change-password" (la ruta en la que estabamos cuando la
  // sesion se invalido); al volver a iniciar sesion, LoginPage navega de
  // vuelta a ese "from" -osea, otra vez aca- aunque mustChangePassword ya
  // sea false. No es que el backend vuelva a exigir el cambio, es que el
  // redirect post-login cae de nuevo en esta misma pantalla por accidente.
  if (user && !user.mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
        <div className="mb-6 sm:mb-8 flex justify-center">
          <img src={logo} alt="Imperial" className="h-10 w-auto" />
        </div>
        <div className="mb-4">
          <Alert tone="warning">Debe cambiar su contraseña antes de continuar.</Alert>
        </div>
        <ChangePasswordForm autoFocus />
      </div>
    </div>
  );
}
