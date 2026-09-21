import { Field, Input, Select } from "./ui";
import { BARCODE_OPTIONS } from "../lib/labelOptions";
import type { AssetLabelBarcodeType, AssetLabelConfig } from "../types/asset";

// Campos de configuracion de la etiqueta fisica (tamano, tipo de codigo y
// que datos mostrar). Compartido entre PrintAssetLabels y el panel de
// etiquetas nuevas de la toma de inventario.
export function LabelConfigFields({
  config,
  onChange,
}: {
  config: AssetLabelConfig;
  onChange: (config: AssetLabelConfig) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 min-[900px]:grid-cols-6">
      <Field label="Ancho (mm)" htmlFor="widthMm">
        <Input
          id="widthMm"
          type="number"
          min={10}
          value={config.widthMm}
          onChange={(e) => onChange({ ...config, widthMm: Number(e.target.value) })}
        />
      </Field>
      <Field label="Alto (mm)" htmlFor="heightMm">
        <Input
          id="heightMm"
          type="number"
          min={10}
          value={config.heightMm}
          onChange={(e) => onChange({ ...config, heightMm: Number(e.target.value) })}
        />
      </Field>
      <div className="min-[900px]:col-span-2">
        <Field label="Código" htmlFor="barcodeType">
          <Select
            id="barcodeType"
            value={config.barcodeType}
            onChange={(e) => onChange({ ...config, barcodeType: e.target.value as AssetLabelBarcodeType })}
          >
            {BARCODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-end gap-4 min-[900px]:col-span-2">
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={config.showProductName}
            onChange={(e) => onChange({ ...config, showProductName: e.target.checked })}
          />
          Producto
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={config.showSerialNumber}
            onChange={(e) => onChange({ ...config, showSerialNumber: e.target.checked })}
          />
          N° serie
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={config.showBorder}
            onChange={(e) => onChange({ ...config, showBorder: e.target.checked })}
          />
          Borde
        </label>
      </div>
    </div>
  );
}
