import { useState } from "react";
import { showErrorToast, showSuccessToast } from "../Toast";
import { Alert, Button } from "../ui";

// Plan 017: los codigos de recuperacion se muestran UNA sola vez (el backend solo guarda su hash).
// No se deja seguir hasta confirmar que se guardaron.
export function RecoveryCodesPanel({
  codes,
  onContinue,
  continueLabel = "Continuar",
}: {
  codes: string[];
  onContinue: () => void;
  continueLabel?: string;
}) {
  const [saved, setSaved] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      showSuccessToast("Codigos copiados al portapapeles.");
    } catch {
      showErrorToast("No se pudieron copiar. Anotelos o descarguelos.");
    }
  }

  function handleDownload() {
    const text =
      "Codigos de recuperacion (cada uno sirve una sola vez)\n" +
      `Generados el ${new Date().toLocaleString("es-CL")}\n\n` +
      codes.join("\n") +
      "\n";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "codigos-recuperacion.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning">
        Guarde estos codigos en un lugar seguro. Si pierde su telefono o su passkey, son la unica forma de entrar sin
        pedir ayuda al administrador. Cada uno sirve una sola vez y no se volveran a mostrar.
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-sm text-slate-800">
        {codes.map((code) => (
          <li key={code} className="text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void handleCopy()} className="flex-1">
          Copiar
        </Button>
        <Button type="button" variant="secondary" onClick={handleDownload} className="flex-1">
          Descargar
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />
        Ya guarde mis codigos de recuperacion
      </label>
      <Button type="button" disabled={!saved} onClick={onContinue} className="w-full">
        {continueLabel}
      </Button>
    </div>
  );
}
