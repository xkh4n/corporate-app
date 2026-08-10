import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ApiError } from "../lib/apiClient";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Field } from "../components/ui/Field";
import { Alert } from "../components/ui/Alert";
import logo from "../assets/imperial-logo.png";

interface LocationState {
  from?: { pathname: string };
}

function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return err.message;
    if (err.status === 401) return err.message;
    return err.message || "No se pudo iniciar sesion. Intente nuevamente.";
  }
  return "No se pudo conectar con el servidor. Verifique su conexion.";
}

export function LoginPage() {
  const { status, sessionNotice, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === "authenticated") {
    const from = (location.state as LocationState | null)?.from?.pathname ?? "/";
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      const from = (location.state as LocationState | null)?.from?.pathname ?? "/";
      navigate(from, { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 flex justify-center">
          <img src={logo} alt="Imperial" className="h-10 w-auto" />
        </div>
        {sessionNotice && (
          <div className="mb-4">
            <Alert tone="warning">{sessionNotice}</Alert>
          </div>
        )}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Field label="Usuario" htmlFor="username">
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="Contraseña" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <Button type="submit" loading={loading} className="w-full">
            Iniciar sesion
          </Button>
        </form>
      </div>
    </div>
  );
}
