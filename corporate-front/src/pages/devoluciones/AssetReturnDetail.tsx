import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, EmptyState, Spinner } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { assetReturnService } from "../../services/assetReturnService";
import type { AssetReturnDetail } from "../../types/assetReturn";
import { downloadBlob } from "../../lib/downloadBlob";
import { isSystemsRole } from "../../lib/roleCostCenter";
import { formatDateTime, statusLabel } from "../inventario/inventoryLabels";
import { CandidatePicker } from "./CandidatePicker";
import {
  MAX_GUIDE_SIZE_BYTES,
  RETURN_SCOPE_LABELS,
  RETURN_STATUS_CLASSES,
  RETURN_STATUS_LABELS,
} from "./assetReturnLabels";

const TH = "px-4 py-2 text-left font-semibold text-slate-600";

// Una devolucion puntual. Segun su estado y los permisos del usuario:
//  - DRAFT + asset-returns:create: agregar/quitar activos, adjuntar la guia,
//    "Enviar a Adquisiciones" y cancelar.
//  - SENT + asset-returns:update + rol de Sistemas (1110) o admin: recepcion por activo.
//  - Cualquier estado: descargar la guia (asset-returns:read). Solo se ofrece la descarga: el servidor la
//    entrega como archivo (attachment) ya saneado, no se abre en el visor del navegador.
export function AssetReturnDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<AssetReturnDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Accion en curso ("upload", "send", ...) para deshabilitar botones y mostrar spinner.
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set());

  async function load(): Promise<void> {
    try {
      setDetail(await assetReturnService.getById(id));
    } catch (error) {
      setDetail(null);
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Ejecuta una accion que devuelve el detalle actualizado.
  async function run(key: string, action: () => Promise<AssetReturnDetail>, success: string): Promise<boolean> {
    setBusy(key);
    try {
      setDetail(await action());
      setSelectedLineIds(new Set());
      showSuccessToast(success);
      return true;
    } catch (error) {
      handleError(error, navigate);
      // Un fallo (ej. un activo ya no es devolvible) puede haber cambiado el estado real: se relee.
      void load();
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function handleGuideSelected(file: File | undefined): Promise<void> {
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      showErrorToast("La guía de despacho debe ser un archivo PDF");
      return;
    }
    if (file.size > MAX_GUIDE_SIZE_BYTES) {
      showErrorToast("La guía no puede superar los 5 MB");
      return;
    }
    setBusy("upload");
    try {
      const result = await assetReturnService.uploadDocument(id, file);
      showSuccessToast(`Guía adjuntada como ${result.filename}`);
      await load();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  // Descarga el archivo (el servidor la entrega como attachment).
  async function handleDownload(): Promise<void> {
    setBusy("download");
    try {
      const blob = await assetReturnService.downloadDocument(id);
      downloadBlob(blob, `${detail?.code ?? `devolucion-${id}`}.pdf`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setBusy(null);
    }
  }

  function handleSend(): void {
    if (!detail) return;
    const message =
      `¿Enviar la devolución ${detail.code} a Adquisiciones?\n\n` +
      `${detail.lineCount} activo(s) pasarán a "En tránsito a devolución" y dejarán de estar asignados a su usuario.`;
    if (!window.confirm(message)) return;
    void run("send", () => assetReturnService.send(id), "Devolución enviada a Adquisiciones");
  }

  function handleCancel(): void {
    if (!window.confirm("¿Cancelar la devolución? Se libera a los activos y se elimina la guía adjunta.")) return;
    void run("cancel", () => assetReturnService.cancel(id), "Devolución cancelada");
  }

  function toggleLine(lineId: number): void {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  if (loading) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div>
        <BackButton onBack={onBack} />
        <EmptyState title="Devolución no encontrada" description="La devolución no existe o no se pudo cargar." />
      </div>
    );
  }

  const isDraft = detail.status === "DRAFT";
  const isSent = detail.status === "SENT";
  // El servidor es quien manda (403); esto solo evita mostrar botones que fallarian.
  // Modificar (agregar/quitar, guia, enviar, cancelar): el solicitante o un admin.
  // Recibir: solo Sistemas (rol del centro de costo 1110) o un admin, aunque haya solicitado o enviado.
  const isAdmin = user?.roleName === "admin";
  const isRequester = user !== null && user !== undefined && detail.requestedBy?.userId === user.userId;
  const canRequest = can("asset-returns:create") && (isAdmin || isRequester);
  const canReceive = can("asset-returns:update") && (isAdmin || isSystemsRole(user?.roleName));
  const pendingLines = detail.lines.filter((line) => line.receivedAt === null);
  const showSelection = isSent && canReceive;
  const cannotSendReason = !detail.hasDocument
    ? "Adjunte la guía de despacho para poder enviar"
    : detail.lineCount === 0
      ? "Agregue al menos un activo"
      : null;

  return (
    <div>
      <BackButton onBack={onBack} />

      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-800">{detail.code ?? "Devolución sin guía"}</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RETURN_STATUS_CLASSES[detail.status]}`}>
            {RETURN_STATUS_LABELS[detail.status]}
          </span>
          {(isSent || detail.status === "RECEIVED") && (
            <span className="text-sm text-slate-600">
              {detail.receivedCount} de {detail.lineCount} recibidos
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {RETURN_SCOPE_LABELS[detail.scope]} · Centro de costo:{" "}
          {detail.costCenter ? `${detail.costCenter.code} · ${detail.costCenter.name}` : "-"} ·
          Solicitante: {detail.requestedBy?.fullName ?? "-"} · Creada: {formatDateTime(detail.createdAt)}
          {detail.sentAt && (
            <>
              {" "}
              · Enviada: {formatDateTime(detail.sentAt)}
              {detail.sentBy ? ` por ${detail.sentBy.fullName}` : ""}
            </>
          )}
          {detail.receivedAt && <> · Recibida: {formatDateTime(detail.receivedAt)}</>}
        </p>
        {detail.notes && <p className="mt-1 text-sm text-slate-600">Notas: {detail.notes}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isDraft && canRequest && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => void handleGuideSelected(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="secondary"
                loading={busy === "upload"}
                onClick={() => fileInputRef.current?.click()}
              >
                {detail.hasDocument ? "Reemplazar guía" : "Adjuntar guía de despacho"}
              </Button>
            </>
          )}
          {detail.hasDocument && (
            <>
              <Button type="button" variant="secondary" loading={busy === "download"} onClick={() => void handleDownload()}>
                Descargar guía
              </Button>
            </>
          )}
          {isDraft && canRequest && (
            <>
              <Button
                type="button"
                variant="success"
                loading={busy === "send"}
                disabled={cannotSendReason !== null}
                title={cannotSendReason ?? undefined}
                onClick={handleSend}
              >
                Enviar a Adquisiciones
              </Button>
              <Button type="button" variant="ghost" loading={busy === "cancel"} onClick={handleCancel}>
                Cancelar devolución
              </Button>
            </>
          )}
          {isSent && !canReceive && pendingLines.length > 0 && (
            <span className="text-sm text-slate-500">Pendiente de recepción por Sistemas (centro de costo 1110).</span>
          )}
          {showSelection && pendingLines.length > 0 && (
            <>
              <Button
                type="button"
                loading={busy === "receive"}
                disabled={selectedLineIds.size === 0}
                onClick={() =>
                  void run(
                    "receive",
                    () => assetReturnService.receive(id, [...selectedLineIds]),
                    "Recepción registrada",
                  )
                }
              >
                Recibir seleccionados ({selectedLineIds.size})
              </Button>
              <Button
                type="button"
                variant="success"
                loading={busy === "receive-all"}
                onClick={() =>
                  void run("receive-all", () => assetReturnService.receive(id), "Todos los activos recibidos")
                }
              >
                Recibir todos ({pendingLines.length})
              </Button>
            </>
          )}
        </div>
        {isDraft && cannotSendReason && canRequest && <p className="mt-2 text-sm text-amber-700">{cannotSendReason}.</p>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {showSelection && <th className={TH} />}
              <th className={TH}>Tag</th>
              <th className={TH}>Producto</th>
              <th className={TH}>N° de serie</th>
              <th className={TH}>Lo tenía</th>
              <th className={TH}>Estado actual</th>
              <th className={TH}>Recibido</th>
              {isDraft && canRequest && <th className={TH} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.lines.map((line) => (
              <tr key={line.id}>
                {showSelection && (
                  <td className="px-4 py-2">
                    {line.receivedAt === null && (
                      <input
                        type="checkbox"
                        aria-label={`Recibir ${line.tag}`}
                        checked={selectedLineIds.has(line.id)}
                        onChange={() => toggleLine(line.id)}
                      />
                    )}
                  </td>
                )}
                <td className="px-4 py-2 font-medium text-slate-900">{line.tag}</td>
                <td className="px-4 py-2 text-slate-600">{line.productName ?? "-"}</td>
                <td className="px-4 py-2 text-slate-600">{line.serialNumber ?? "-"}</td>
                <td className="px-4 py-2 text-slate-600">{line.holder?.fullName ?? "-"}</td>
                <td className="px-4 py-2 text-slate-600">{statusLabel(line.statusCode)}</td>
                <td className="px-4 py-2 text-slate-600">{formatDateTime(line.receivedAt)}</td>
                {isDraft && canRequest && (
                  <td className="px-4 py-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      loading={busy === `remove-${line.id}`}
                      onClick={() =>
                        void run(`remove-${line.id}`, () => assetReturnService.removeLine(id, line.id), `${line.tag} quitado`)
                      }
                    >
                      Quitar
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDraft && canRequest && detail.costCenter && (
        <div className="mt-4">
          {adding ? (
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-slate-700">Agregar activos</h3>
                <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                  Cerrar
                </Button>
              </div>
              <CandidatePicker
                scope={detail.scope}
                costCenterId={detail.costCenter.id}
                confirmLabel="Agregar"
                busy={busy === "add"}
                onConfirm={async (assetIds) => {
                  if (await run("add", () => assetReturnService.addLines(id, assetIds), "Activos agregados")) {
                    setAdding(false);
                  }
                }}
              />
            </div>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
              Agregar activos
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <div className="mb-4">
      <Button type="button" variant="secondary" onClick={onBack}>
        ← Volver al listado
      </Button>
    </div>
  );
}
