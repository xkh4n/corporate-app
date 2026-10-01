import { useState, type FormEvent } from "react";
import { useAuth } from "../../auth/useAuth";
import { ApiError } from "../../lib/apiClient";
import { IsPassword } from "../../lib/Validations";
import { showSuccessToast } from "../Toast";
import { Alert, Button, Field, Input } from "../ui";

function changePasswordErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message || "No se pudo cambiar la contraseña. Intente nuevamente.";
  }
  return "No se pudo conectar con el servidor. Verifique su conexion.";
}

// Formulario de autoservicio sobre PATCH /auth/change-password. Lo usan la pantalla obligatoria
// (ChangePasswordPage, primer ingreso o reset administrativo) y "Seguridad de mi cuenta". En ambos
// casos el backend invalida todas las sesiones al cambiarla: el usuario vuelve al login.
export function ChangePasswordForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const { changePassword } = useAuth();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      // El cambio ya invalido la sesion (ver AuthContext.changePassword): el AuthProvider vuelve a
      // "anonymous" solo y ProtectedRoute manda a /login -este toast es lo unico que hace falta aca.
      showSuccessToast("Contraseña actualizada. Inicie sesion nuevamente.");
    } catch (err) {
      setError(changePasswordErrorMessage(err));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <Field label="Contraseña actual" htmlFor="currentPassword">
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          autoFocus={autoFocus}
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
  );
}
