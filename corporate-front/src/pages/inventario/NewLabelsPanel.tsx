import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LabelConfigFields } from "../../components/LabelConfigFields";
import { Button } from "../../components/ui";
import { showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { DEFAULT_LABEL_CONFIG } from "../../lib/labelOptions";
import { downloadZplFile, isWebUsbSupported, printZplViaWebUsb } from "../../lib/zplPrinting";
import { inventoryCountService } from "../../services";
import type { AssetLabelConfig } from "../../types/asset";

// Etiquetas de los activos que creo la toma. El ZPL lo genera el backend (solo
// de esos activos, sin exigir assets:read); la impresion REAL la hace este
// navegador via WebUSB, nunca el backend. "etiquetas.txt" es el mismo ZPL, para
// mandarlo a la impresora por otra via.
export function NewLabelsPanel({ countId, labelCount }: { countId: number; labelCount: number }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AssetLabelConfig>(DEFAULT_LABEL_CONFIG);
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    try {
      const zpl = await inventoryCountService.downloadLabels(countId, config);
      downloadZplFile(zpl, "etiquetas.txt");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setDownloading(false);
    }
  }

  async function handlePrint(): Promise<void> {
    setPrinting(true);
    try {
      const zpl = await inventoryCountService.downloadLabels(countId, config);
      await printZplViaWebUsb(zpl);
      showSuccessToast(`${labelCount} etiqueta(s) enviada(s) a la impresora`);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-sky-200 bg-white p-4">
      <h2 className="mb-1 text-base font-semibold text-slate-800">Etiquetas nuevas</h2>
      <p className="mb-4 text-sm text-slate-600">
        La toma dio de alta {labelCount} equipo(s) con etiqueta nueva. Imprímalas y péguelas en cada equipo.
      </p>
      <LabelConfigFields config={config} onChange={setConfig} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" loading={downloading} onClick={() => void handleDownload()}>
          Descargar etiquetas.txt
        </Button>
        <Button
          type="button"
          variant="success"
          loading={printing}
          disabled={!isWebUsbSupported()}
          onClick={() => void handlePrint()}
          title={isWebUsbSupported() ? undefined : "Este navegador no soporta WebUSB (usa Chrome/Edge)"}
        >
          Imprimir etiquetas ({labelCount})
        </Button>
      </div>
    </div>
  );
}
