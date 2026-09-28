import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, Field, Input, Spinner, Textarea } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { downloadBlob } from "../../lib/downloadBlob";
import { assetWriteOffService } from "../../services/assetWriteOffService";
import type { WriteOffDetail, WriteOffLine } from "../../types/assetWriteOff";
import { CLASSIFICATION_LABEL, STAGE_LABEL, formatMoney } from "./accountingLabels";

// Detalle de una baja contable (plan 008): borrador editable (datos,
// certificado, fotos por activo, confirmar/descartar) o baja confirmada en
// solo lectura. Mismos topes que la API: 5 MB por archivo.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png"];
const TH = "px-3 py-2 text-left font-semibold text-slate-600";

type Busy = "save" | "certificate" | "download" | "photo" | "confirm" | "discard" | null;
type PendingAction = "confirm" | "discard" | null;

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface Props {
    id: number;
    onBack: () => void;
    // closed = la baja ya no esta abierta (se descarto).
    onChanged: (closed: boolean) => void;
}

export function WriteOffPanel({ id, onBack, onChanged }: Props) {
    const navigate = useNavigate();
    const { can } = useAuth();
    const [detail, setDetail] = useState<WriteOffDetail | null>(null);
    const [busy, setBusy] = useState<Busy>(null);
    const [pending, setPending] = useState<PendingAction>(null);

    const [writeOffDate, setWriteOffDate] = useState("");
    const [reason, setReason] = useState("");
    const [notary, setNotary] = useState("");
    const [certificateNumber, setCertificateNumber] = useState("");

    const certificateInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const [photoAssetId, setPhotoAssetId] = useState<number | null>(null);

    const applyDetail = useCallback((next: WriteOffDetail) => {
        setDetail(next);
        setWriteOffDate(next.writeOffDate ?? "");
        setReason(next.reason ?? "");
        setNotary(next.notary ?? "");
        setCertificateNumber(next.certificateNumber ?? "");
    }, []);

    const load = useCallback(async () => {
        try {
            applyDetail(await assetWriteOffService.get(id));
        } catch (error) {
            handleError(error, navigate);
        }
    }, [id, navigate, applyDetail]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!detail) {
        return (
            <div className="flex justify-center py-12">
                <Spinner />
            </div>
        );
    }

    const isDraft = detail.status === "DRAFT";
    const editable = isDraft && can("asset-write-offs:create");
    const canConfirm = isDraft && can("asset-write-offs:approve");
    // Plan 013: la foto de Dar de Baja Activos cuenta; lo que dio de baja la toma de inventario la sube aca.
    const hasPhoto = (line: (typeof detail.lines)[number]) => line.photos.length + line.decommissionPhotos.length > 0;
    const linesWithoutPhoto = detail.lines.filter((line) => !hasPhoto(line));
    const dataDirty =
        writeOffDate !== (detail.writeOffDate ?? "") ||
        reason !== (detail.reason ?? "") ||
        notary !== (detail.notary ?? "") ||
        certificateNumber !== (detail.certificateNumber ?? "");
    const missing = [
        !detail.writeOffDate && "la fecha de baja",
        !detail.reason && "el motivo",
        !detail.hasCertificate && "el certificado notarial",
        linesWithoutPhoto.length > 0 && `fotos de ${linesWithoutPhoto.map((line) => line.tag).join(", ")}`,
    ].filter((item): item is string => !!item);
    const draftBookValue = detail.lines.reduce((sum, line) => sum + Number(line.bookValue), 0);

    async function run(kind: Exclude<Busy, null>, action: () => Promise<void>) {
        setBusy(kind);
        try {
            await action();
        } catch (error) {
            handleError(error, navigate);
        } finally {
            setBusy(null);
        }
    }

    function handleSave() {
        void run("save", async () => {
            applyDetail(
                await assetWriteOffService.update(id, {
                    writeOffDate: writeOffDate || undefined,
                    reason: reason.trim() || undefined,
                    notary: notary.trim() || null,
                    certificateNumber: certificateNumber.trim() || null,
                }),
            );
            showSuccessToast("Datos de la baja guardados");
        });
    }

    function handleCertificateSelected(file: File | undefined) {
        if (certificateInputRef.current) certificateInputRef.current.value = "";
        if (!file) return;
        if (file.type !== "application/pdf") return showErrorToast("El certificado notarial debe ser un archivo PDF");
        if (file.size > MAX_FILE_SIZE_BYTES) return showErrorToast("El certificado no puede superar los 5 MB");
        void run("certificate", async () => {
            applyDetail(await assetWriteOffService.uploadCertificate(id, file));
            showSuccessToast("Certificado notarial adjuntado");
        });
    }

    function handleDownloadCertificate() {
        void run("download", async () => {
            downloadBlob(await assetWriteOffService.downloadCertificate(id), `certificado-baja-${id}.pdf`);
        });
    }

    function pickPhoto(assetId: number) {
        setPhotoAssetId(assetId);
        photoInputRef.current?.click();
    }

    function handlePhotoSelected(files: FileList | null) {
        const selected = files ? [...files] : [];
        if (photoInputRef.current) photoInputRef.current.value = "";
        if (photoAssetId === null || selected.length === 0) return;
        const invalid = selected.find((file) => !PHOTO_TYPES.includes(file.type) || file.size > MAX_FILE_SIZE_BYTES);
        if (invalid) return showErrorToast(`«${invalid.name}»: las fotos deben ser JPEG o PNG de hasta 5 MB`);
        const assetId = photoAssetId;
        void run("photo", async () => {
            // Una request por foto (la API recibe un archivo por subida).
            for (const file of selected) await assetWriteOffService.uploadPhoto(id, assetId, file);
            showSuccessToast(`${selected.length} foto(s) agregada(s)`);
            await load();
        });
    }

    function handleRemovePhoto(photoId: number) {
        void run("photo", async () => {
            await assetWriteOffService.removePhoto(id, photoId);
            await load();
        });
    }

    function handleRemoveLine(line: WriteOffLine) {
        void run("save", async () => {
            const assetIds = detail!.lines.map((item) => item.assetId).filter((assetId) => assetId !== line.assetId);
            applyDetail(await assetWriteOffService.update(id, { assetIds }));
            showSuccessToast(`${line.tag} quitado de la baja`);
        });
    }

    function handleConfirm() {
        void run("confirm", async () => {
            const confirmed = await assetWriteOffService.confirm(id);
            applyDetail(confirmed);
            setPending(null);
            showSuccessToast(
                `Baja #${confirmed.id} confirmada: ${confirmed.assetCount} activo(s), valor libro ${formatMoney(
                    confirmed.totalBookValue,
                )}`,
            );
            onChanged(false);
        });
    }

    function handleDiscard() {
        void run("discard", async () => {
            await assetWriteOffService.discard(id);
            showSuccessToast(`Borrador #${id} descartado`);
            onChanged(true);
        });
    }

    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-800">
                    Baja #{detail.id} ·{" "}
                    <span className={isDraft ? "text-amber-700" : "text-emerald-700"}>
                        {isDraft ? "Borrador" : "Confirmada (definitiva)"}
                    </span>
                </h2>
                <Button type="button" variant="secondary" onClick={onBack}>
                    Volver al listado
                </Button>
            </div>

            <section className="grid grid-cols-1 gap-3 min-[800px]:grid-cols-2">
                <Field label="Fecha de baja" htmlFor="writeOffDate">
                    <Input
                        id="writeOffDate"
                        type="date"
                        max={today()}
                        value={writeOffDate}
                        disabled={!editable}
                        onChange={(e) => setWriteOffDate(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                    />
                </Field>
                <Field label="Notaría (opcional)" htmlFor="notary">
                    <Input
                        id="notary"
                        maxLength={120}
                        value={notary}
                        disabled={!editable}
                        onChange={(e) => setNotary(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                    />
                </Field>
                <Field label="Motivo" htmlFor="reason">
                    <Textarea
                        id="reason"
                        rows={2}
                        maxLength={255}
                        value={reason}
                        disabled={!editable}
                        onChange={(e) => setReason(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                    />
                </Field>
                <Field label="N° de certificado o repertorio (opcional)" htmlFor="certificateNumber">
                    <Input
                        id="certificateNumber"
                        maxLength={60}
                        value={certificateNumber}
                        disabled={!editable}
                        onChange={(e) => setCertificateNumber(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                    />
                </Field>
            </section>
            {editable && (
                <div className="flex justify-end">
                    <Button type="button" disabled={!dataDirty} loading={busy === "save"} onClick={handleSave}>
                        Guardar datos
                    </Button>
                </div>
            )}

            <section className="flex flex-wrap items-center justify-between gap-3 rounded bg-slate-50 p-3 text-sm">
                <div>
                    <p className="font-semibold text-slate-800">Certificado notarial</p>
                    <p className="text-slate-600">
                        {detail.hasCertificate ? "Adjuntado (PDF)." : "Sin adjuntar: es obligatorio para confirmar."}
                    </p>
                </div>
                <div className="flex gap-2">
                    {detail.hasCertificate && (
                        <Button
                            type="button"
                            variant="secondary"
                            loading={busy === "download"}
                            onClick={handleDownloadCertificate}
                        >
                            Descargar
                        </Button>
                    )}
                    {editable && (
                        <Button
                            type="button"
                            loading={busy === "certificate"}
                            onClick={() => certificateInputRef.current?.click()}
                        >
                            {detail.hasCertificate ? "Reemplazar" : "Subir certificado (PDF)"}
                        </Button>
                    )}
                </div>
                <input
                    ref={certificateInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => handleCertificateSelected(e.target.files?.[0])}
                />
            </section>

            <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <h3 className="font-semibold text-slate-700">Activos ({detail.lines.length})</h3>
                    <span className="text-slate-600">
                        Valor libro {isDraft ? "a dar de baja" : "dado de baja"}:{" "}
                        <strong>{formatMoney(isDraft ? draftBookValue : detail.totalBookValue)}</strong>
                    </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className={TH}>Activo</th>
                                <th className={TH}>Clasificación</th>
                                <th className={TH}>{isDraft ? "Etapa" : "Etapa al dar de baja"}</th>
                                <th className={`${TH} text-right`}>Valor libro</th>
                                <th className={TH}>Fotos</th>
                                {editable && <th className="px-3 py-2" />}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {detail.lines.map((line) => (
                                <tr key={line.assetId} className={isDraft && !hasPhoto(line) ? "bg-amber-50" : undefined}>
                                    <td className="px-3 py-2">
                                        <p className="font-medium text-slate-900">{line.tag}</p>
                                        <p className="text-xs text-slate-500">{line.productName ?? line.serialNumber ?? "-"}</p>
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">{CLASSIFICATION_LABEL[line.classification]}</td>
                                    <td className="px-3 py-2 text-slate-600">{STAGE_LABEL[line.stage]}</td>
                                    <td className="px-3 py-2 text-right text-slate-800">{formatMoney(line.bookValue)}</td>
                                    <td className="px-3 py-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {line.decommissionPhotos.map((photo) => (
                                                <a
                                                    key={`d-${photo.id}`}
                                                    href={assetWriteOffService.decommissionPhotoUrl(id, photo.id)}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Foto tomada al dar de baja"
                                                >
                                                    <img
                                                        src={assetWriteOffService.decommissionPhotoUrl(id, photo.id)}
                                                        alt={`Foto de ${line.tag} al darlo de baja`}
                                                        className="h-14 w-14 rounded border-2 border-indigo-300 object-cover"
                                                    />
                                                </a>
                                            ))}
                                            {line.photos.map((photo) => (
                                                <div key={photo.id} className="relative">
                                                    <a
                                                        href={assetWriteOffService.photoUrl(id, photo.id)}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <img
                                                            src={assetWriteOffService.photoUrl(id, photo.id)}
                                                            alt={`Foto de ${line.tag}`}
                                                            className="h-14 w-14 rounded border border-slate-200 object-cover"
                                                        />
                                                    </a>
                                                    {editable && (
                                                        <button
                                                            type="button"
                                                            title="Quitar foto"
                                                            disabled={busy !== null}
                                                            onClick={() => handleRemovePhoto(photo.id)}
                                                            className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-rose-600 text-xs leading-5 text-white"
                                                        >
                                                            ×
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                            {editable && line.decommissionPhotos.length === 0 && (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    className="px-2! py-1! text-xs"
                                                    loading={busy === "photo" && photoAssetId === line.assetId}
                                                    disabled={busy !== null}
                                                    onClick={() => pickPhoto(line.assetId)}
                                                >
                                                    + Foto
                                                </Button>
                                            )}
                                            {!hasPhoto(line) && !editable && <span className="text-xs text-slate-400">-</span>}
                                        </div>
                                    </td>
                                    {editable && (
                                        <td className="px-3 py-2 text-right">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="px-2! py-1! text-xs"
                                                disabled={detail.lines.length === 1 || busy !== null}
                                                title={detail.lines.length === 1 ? "La baja debe tener al menos un activo" : undefined}
                                                onClick={() => handleRemoveLine(line)}
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
                <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    className="hidden"
                    onChange={(e) => handlePhotoSelected(e.target.files)}
                />
            </section>

            {isDraft && (
                <section className="space-y-3 border-t border-slate-200 pt-4">
                    {missing.length > 0 ? (
                        <p className="text-sm text-amber-800">Para confirmar falta: {missing.join("; ")}.</p>
                    ) : dataDirty ? (
                        <p className="text-sm text-amber-800">Guarde los datos antes de confirmar.</p>
                    ) : (
                        <p className="text-sm text-emerald-800">La baja está completa y lista para confirmar.</p>
                    )}

                    {pending === null && (
                        <div className="flex flex-wrap justify-end gap-2">
                            {editable && (
                                <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setPending("discard")}>
                                    Descartar borrador
                                </Button>
                            )}
                            {canConfirm ? (
                                <Button
                                    type="button"
                                    variant="success"
                                    disabled={missing.length > 0 || dataDirty || busy !== null}
                                    onClick={() => setPending("confirm")}
                                >
                                    Confirmar baja
                                </Button>
                            ) : (
                                <span className="self-center text-xs text-slate-500">
                                    Confirmar requiere el permiso «Confirmar bajas contables de activos».
                                </span>
                            )}
                        </div>
                    )}

                    {pending !== null && (
                        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
                            <p>
                                {pending === "confirm"
                                    ? `¿Confirmar la baja contable de ${detail.lines.length} activo(s) por un valor libro de ${formatMoney(
                                          draftBookValue,
                                      )}? Es definitiva: no se puede anular ni modificar.`
                                    : `¿Descartar el borrador #${detail.id}? Se borrarán sus fotos y el certificado adjunto.`}
                            </p>
                            <div className="mt-3 flex justify-end gap-2">
                                <Button type="button" variant="secondary" onClick={() => setPending(null)} disabled={busy !== null}>
                                    Cancelar
                                </Button>
                                <Button
                                    type="button"
                                    variant="primary"
                                    className="bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                                    loading={busy === "confirm" || busy === "discard"}
                                    onClick={pending === "confirm" ? handleConfirm : handleDiscard}
                                >
                                    {pending === "confirm" ? "Sí, confirmar baja" : "Sí, descartar"}
                                </Button>
                            </div>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
