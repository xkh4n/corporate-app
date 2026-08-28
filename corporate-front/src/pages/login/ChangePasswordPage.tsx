import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Field } from "../../components/ui/Field";
import { Alert } from "../../components/ui/Alert";
import { showSuccessToast } from "../../components/Toast";
import { IsPassword } from "../../lib/Validations";
import logo from "../../assets/imperial-logo.png";

function changePasswordErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || "No se pudo cambiar la contraseña. Intente nuevamente.";
  }
  return "No se pudo conectar con el servidor. Verifique su conexion.";
}

// Pantalla obligatoria (ver MustChangePasswordGate en AppRoutes.tsx): se
// muestra en vez de cualquier otra ruta mientras user.mustChangePassword sea
// true -primer login con la password por defecto, o despues de un reset
// administrativo. Reutiliza el mismo PATCH /auth/change-password de
// auto-servicio que un cambio de password voluntario (no hay endpoint
// separado), asi que tambien queda alcanzable "a mano" fuera de ese flujo.
export function ChangePasswordPage() {
  const { user, changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sin esto: tras cambiar la password, ProtectedRoute manda a /login con
  // state.from="/change-password" (la ruta en la que estabamos cuando la
  // sesion se invalido); al volver a iniciar sesion, LoginPage navega de
  // vuelta a ese "from" -osea, otra vez aca- aunque mustChangePassword ya
  // sea false. No es que el backend vuelva a exigir el cambio, es que el
  // redirect post-login cae de nuevo en esta misma pantalla por accidente.
  // Va DESPUES de los hooks (Rules of Hooks: un return condicional antes
  // de useState los saltea en ese render y React explota).
  if (user && !user.mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!IsPassword(newPassword)) {
      setError("La nueva contraseña debe tener al menos 8 caracteres, con mayuscula, minuscula, numero y simbolo.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La confirmacion no coincide con la nueva contraseña.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("La nueva contraseña debe ser distinta a la actual.");
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      // El cambio ya invalido la sesion (ver AuthContext.changePassword): el
      // AuthProvider vuelve a "anonymous" solo y ProtectedRoute manda a
      // /login -este toast es lo unico que hace falta acá.
      showSuccessToast("Contraseña actualizada. Inicie sesion nuevamente.");
    } catch (err) {
      setError(changePasswordErrorMessage(err));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <img src={logo} alt="Imperial" className="h-10 w-auto" />
        </div>
        <div className="mb-4">
          <Alert tone="warning">Debe cambiar su contraseña antes de continuar.</Alert>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Field label="Contraseña actual" htmlFor="currentPassword">
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>
          <Field label="Contraseña nueva" htmlFor="newPassword">
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirmar contraseña nueva" htmlFor="confirmPassword">
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" loading={loading} className="w-full">
            Cambiar contraseña
          </Button>
        </form>
      </div>
    </div>
  );
}
