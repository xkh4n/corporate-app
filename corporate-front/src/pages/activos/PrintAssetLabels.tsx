import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LabelConfigFields } from "../../components/LabelConfigFields";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Input, Button, EmptyState } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { DEFAULT_LABEL_CONFIG } from "../../lib/labelOptions";
import { renderZplPreview } from "../../lib/labelary";
import { downloadZplFile, isWebUsbSupported, printZplViaWebUsb } from "../../lib/zplPrinting";
import { assetService } from "../../services";
import type { Asset, AssetLabelConfig } from "../../types/asset";

// Generacion/impresion de etiquetas fisicas (Fase F): mismo permiso
// assets:read que el resto de las pantallas de consulta de activos -la
// etiqueta no expone nada que ese permiso no muestre ya. El ZPL lo genera el
// backend (texto plano, sin estado); la impresion REAL la hace este
// navegador via WebUSB, nunca el backend (redes internal:true, ver
// compose.dev.yml de corporate-api).
const REQUIRED_PERMISSIONS = ["assets:read"] as const;

export default function PrintAssetLabels() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [config, setConfig] = useState<AssetLabelConfig>(DEFAULT_LABEL_CONFIG);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  async function handleSearch(): Promise<void> {
    setLoading(true);
    try {
      const res = await assetService.list({ search: search.trim() || undefined, limit: 50 });
      setAssets(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function toggleSelected(id: number): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePreview(): Promise<void> {
    const [firstId] = selectedIds;
    if (firstId === undefined) {
      showErrorToast("Selecciona al menos un activo para previsualizar");
      return;
    }
    setPreviewing(true);
    try {
      const zpl = await assetService.downloadLabel(firstId, config);
      const url = await renderZplPreview(zpl, config.widthMm, config.heightMm);
      setPreviewUrl(url);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleDownload(): Promise<void> {
    if (selectedIds.size === 0) {
      showErrorToast("Selecciona al menos un activo");
      return;
    }
    setDownloading(true);
    try {
      const zpl = await assetService.downloadLabelsBatch([...selectedIds], config);
      downloadZplFile(zpl, "etiquetas-activos.zpl");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setDownloading(false);
    }
  }

  async function handlePrint(): Promise<void> {
    if (selectedIds.size === 0) {
      showErrorToast("Selecciona al menos un activo");
      return;
    }
    setPrinting(true);
    try {
      const zpl = await assetService.downloadLabelsBatch([...selectedIds], config);
      await printZplViaWebUsb(zpl);
      showSuccessToast(`${selectedIds.size} etiqueta(s) enviada(s) a la impresora`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center h-max bg-sky-100 px-0 py-4 sm:p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Generar Etiquetas de Activos
        </h1>

        <div className="w-full sm:max-w-[95%] mx-auto sm:px-4 lg:px-8">
          <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
            <LabelConfigFields config={config} onChange={setConfig} />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button type="button" variant="secondary" loading={previewing} onClick={() => void handlePreview()}>
                Previsualizar
              </Button>
              <Button type="button" variant="secondary" loading={downloading} onClick={() => void handleDownload()}>
                Descargar .zpl
              </Button>
              <Button
                type="button"
                variant="success"
                loading={printing}
                disabled={!isWebUsbSupported()}
                onClick={() => void handlePrint()}
                title={isWebUsbSupported() ? undefined : "Este navegador no soporta WebUSB (usa Chrome/Edge)"}
              >
                Imprimir ({selectedIds.size})
              </Button>
            </div>

            {previewUrl && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                <img src={previewUrl} alt="Vista previa de la etiqueta" className="mx-auto max-w-full" />
              </div>
            )}
          </div>

          <div className="mb-4 flex w-full max-w-md gap-2">
            <Input
              placeholder="Buscar por tag o N° de serie..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
              className="bg-white"
            />
            <Button type="button" variant="secondary" loading={loading} onClick={() => void handleSearch()}>
              Buscar
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : assets.length === 0 ? (
            <EmptyState title="Sin activos" description="No se encontraron activos con ese criterio de búsqueda." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">
                      <input
                        type="checkbox"
                        className="h-5 w-5"
                        checked={assets.length > 0 && selectedIds.size === assets.length}
                        onChange={(e) => setSelectedIds(e.target.checked ? new Set(assets.map((a) => a.id)) : new Set())}
                      />
                    </th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Tag</th>
                    <th className="whitespace-nowrap px-4 py-2 text-left font-semibold text-slate-600">N° de serie</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-600">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assets.map((asset) => (
                    <tr key={asset.id}>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={selectedIds.has(asset.id)}
                          onChange={() => toggleSelected(asset.id)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">{asset.tag}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{asset.serialNumber ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{asset.status.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </RequirePermissions>
  );
}
