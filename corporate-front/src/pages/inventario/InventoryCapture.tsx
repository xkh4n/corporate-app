import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, EmptyState, Field, Input, Select, Spinner } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { IsRut } from "../../lib/Validations";
import { costCenterService, inventoryCountService, productCategoryService, productService } from "../../services";
import type { CostCenter, Product, ProductCategory } from "../../types";
import type {
  InventoryCountDetail,
  InventoryLineInput,
  InventoryLineStatusCode,
  InventoryLookup,
  InventoryLookupBy,
  InventoryReportLine,
} from "../../types/inventoryCount";
import { LINE_STATUS_OPTIONS, isLineStatusCode, statusLabel } from "./inventoryLabels";
import { LineBadges } from "./LineBadges";

const TH = "px-4 py-2 text-left font-semibold text-slate-600";
const INPUT_CLASS = "bg-zinc-100 focus:bg-indigo-100";

interface CaptureForm {
  lookupBy: InventoryLookupBy;
  // Lo que se escaneó o escribió: el TAG, o la serie según lookupBy.
  lookupValue: string;
  categoryId: string;
  productId: string;
  description: string;
  costCenterId: string;
  // Solo se edita al dar de alta un equipo nuevo por TAG; en el resto se toma del activo o de lookupValue.
  serialNumber: string;
  documentId: string;
  holderUserId: number | null;
  holderName: string;
  statusCode: InventoryLineStatusCode | "";
}

const EMPTY_FORM: CaptureForm = {
  lookupBy: "TAG",
  lookupValue: "",
  categoryId: "",
  productId: "",
  description: "",
  costCenterId: "",
  serialNumber: "",
  documentId: "",
  holderUserId: null,
  holderName: "",
  statusCode: "",
};

// Resultado de validar el equipo contra el sistema:
// - none: aún no se validó (o no hay valor).
// - linked: el equipo existe; la toma lo actualiza según el estado declarado.
// - new: no existe; al guardar se crea un activo con una etiqueta nueva.
type TargetState = { kind: "none" } | { kind: "linked"; lookup: InventoryLookup } | { kind: "new"; value: string };

const LOOKUP_LABELS: Record<InventoryLookupBy, string> = { TAG: "TAG", SERIAL: "Serie" };

// Toma abierta: el auditor va ingresando equipos, identificándolos por TAG o por
// serie. El servidor valida siempre si el activo existe (el lookup de esta
// pantalla es solo orientativo).
export function InventoryCapture({ count, onClosed }: { count: InventoryCountDetail; onClosed: () => void }) {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  // El servidor exige ser el auditor que abrio la toma (o admin) para ingresar, quitar y cerrar (403); esto solo evita
  // mostrar controles que fallarian.
  const isAuditor = user?.roleName === "admin" || (user !== null && user !== undefined && count.createdBy === user.userId);
  const canCapture = can("inventory-counts:create") && isAuditor;
  const canEdit = can("inventory-counts:update") && isAuditor;

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const productsRequest = useRef(0);

  const [form, setForm] = useState<CaptureForm>(EMPTY_FORM);
  const [target, setTarget] = useState<TargetState>({ kind: "none" });
  const [scanning, setScanning] = useState(false);
  const [validatingHolder, setValidatingHolder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  const [lines, setLines] = useState<InventoryReportLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const scanInputRef = useRef<HTMLInputElement>(null);

  async function loadLines(): Promise<void> {
    // Las lineas de una toma abierta solo las lee su auditor (el servidor responde 403 al resto).
    if (!isAuditor) {
      setLoadingLines(false);
      return;
    }
    try {
      const res = await inventoryCountService.listLines(count.id, { limit: 1000, sortBy: "id", sortOrder: "desc" });
      setLines(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setLoadingLines(false);
    }
  }

  async function loadCatalogs(): Promise<void> {
    try {
      const [categoryRes, costCenterRes] = await Promise.all([
        productCategoryService.list({ limit: 1000, sortBy: "name" }),
        costCenterService.list({ limit: 1000, sortBy: "code" }),
      ]);
      setCategories(categoryRes.items);
      setCostCenters(costCenterRes.items);
    } catch (error) {
      handleError(error, navigate);
    }
  }

  useEffect(() => {
    void loadLines();
    void loadCatalogs();
    scanInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count.id]);

  // Combo dependiente categoria -> producto. El contador descarta la respuesta
  // de una categoria vieja si el auditor ya cambio de categoria.
  async function loadProducts(categoryId: string): Promise<void> {
    const request = ++productsRequest.current;
    if (!categoryId) {
      setProducts([]);
      return;
    }
    setLoadingProducts(true);
    try {
      const res = await productService.list({ categoryId, limit: 1000, sortBy: "name" });
      if (request === productsRequest.current) setProducts(res.items);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      if (request === productsRequest.current) setLoadingProducts(false);
    }
  }

  function handleCategoryChange(categoryId: string): void {
    setForm((prev) => ({ ...prev, categoryId, productId: "" }));
    void loadProducts(categoryId);
  }

  function handleLookupByChange(lookupBy: InventoryLookupBy): void {
    setForm((prev) => ({ ...prev, lookupBy, lookupValue: "", serialNumber: "" }));
    setTarget({ kind: "none" });
    scanInputRef.current?.focus();
  }

  function handleLookupValueChange(lookupValue: string): void {
    setForm((prev) => ({ ...prev, lookupValue }));
    setTarget({ kind: "none" });
  }

  // Enter en el input de escaneo (el lector USB/Bluetooth emula teclado y
  // termina con Enter): valida el equipo y, si existe, precarga el formulario.
  async function handleLookup(): Promise<void> {
    const value = form.lookupValue.trim();
    if (!value) {
      setTarget({ kind: "none" });
      return;
    }
    setScanning(true);
    try {
      const found = await inventoryCountService.lookup(count.id, form.lookupBy, value);
      if (!found) {
        setTarget({ kind: "new", value });
        setForm((prev) => ({ ...prev, serialNumber: prev.lookupBy === "SERIAL" ? value : "", statusCode: "" }));
        return;
      }
      if (found.alreadyInCount) {
        showErrorToast(`El activo ${found.tag} ya fue ingresado en esta toma`);
        setForm((prev) => ({ ...prev, lookupValue: "" }));
        setTarget({ kind: "none" });
        return;
      }
      setTarget({ kind: "linked", lookup: found });
      // ASIGNADO por defecto (o el estado que la toma impone, p. ej. devolución -> mantención).
      const defaultStatus: InventoryLineStatusCode | "" =
        found.forcedStatusCode ??
        (found.allowedStatusCodes.includes("ASSIGNED") ? "ASSIGNED" : (found.allowedStatusCodes[0] ?? ""));
      setForm((prev) => ({
        ...prev,
        categoryId: found.productCategoryId ?? prev.categoryId,
        productId: found.productId ?? prev.productId,
        costCenterId: found.costCenterId !== null ? String(found.costCenterId) : prev.costCenterId,
        serialNumber: found.serialNumber ?? "",
        statusCode: isLineStatusCode(defaultStatus) ? defaultStatus : "",
        documentId: found.holder?.documentId ?? prev.documentId,
        holderUserId: found.holder?.userId ?? prev.holderUserId,
        holderName: found.holder?.fullName ?? prev.holderName,
      }));
      if (found.productCategoryId) void loadProducts(found.productCategoryId);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setScanning(false);
    }
  }

  async function handleValidateHolder(): Promise<void> {
    const documentId = form.documentId.trim();
    if (!documentId || !IsRut(documentId)) {
      showErrorToast("El RUT no es válido");
      return;
    }
    setValidatingHolder(true);
    try {
      // El servidor busca el RUT EXACTO (no hay busqueda parcial): no se asigna por error a un RUT parecido.
      const found = await inventoryCountService.findHolder(documentId);
      if (!found) {
        showErrorToast("No existe un usuario activo con ese RUT");
        setForm((prev) => ({ ...prev, holderUserId: null, holderName: "" }));
        return;
      }
      setForm((prev) => ({
        ...prev,
        holderUserId: found.userId,
        holderName: found.fullName,
      }));
      showSuccessToast("Usuario encontrado");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setValidatingHolder(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    // Un valor tipeado que aun no se valido: se valida primero (precarga los
    // datos si existe) y el auditor revisa antes de guardar.
    if (form.lookupValue.trim() && target.kind === "none") {
      await handleLookup();
      return;
    }
    if (!form.lookupValue.trim()) {
      showErrorToast(`Ingresa el ${LOOKUP_LABELS[form.lookupBy]} del equipo`);
      return;
    }
    if (!form.categoryId || !form.productId) {
      showErrorToast("Selecciona la categoría y el producto");
      return;
    }
    if (!form.costCenterId) {
      showErrorToast("Selecciona el centro de costo");
      return;
    }
    if (!form.statusCode) {
      showErrorToast("Selecciona el estado del equipo");
      return;
    }
    const serialNumber = form.lookupBy === "SERIAL" ? form.lookupValue.trim() : form.serialNumber.trim();
    if (target.kind !== "linked" && !serialNumber) {
      showErrorToast("La serie es obligatoria para dar de alta un equipo nuevo");
      return;
    }
    if (form.statusCode === "ASSIGNED" && form.holderUserId === null) {
      showErrorToast("Un equipo asignado requiere validar el usuario por RUT");
      return;
    }

    const body: InventoryLineInput = {
      lookupBy: form.lookupBy,
      tag: form.lookupBy === "TAG" ? form.lookupValue.trim() : null,
      productCategoryId: form.categoryId,
      productId: form.productId,
      description: form.description.trim() || null,
      costCenterId: Number(form.costCenterId),
      serialNumber: serialNumber || null,
      holderUserId: form.holderUserId,
      statusCode: form.statusCode,
    };

    setSaving(true);
    try {
      const saved = await inventoryCountService.addLine(count.id, body);
      showSuccessToast(
        saved.assetCreated
          ? `Equipo dado de alta. Etiqueta nueva: ${saved.asset?.tag ?? ""}`
          : `Equipo ${saved.asset?.tag ?? ""} actualizado`,
      );
      // Se conservan el modo de busqueda, la categoria, el producto y el centro de
      // costo: el auditor suele ingresar varios equipos iguales seguidos.
      setForm((prev) => ({
        ...EMPTY_FORM,
        lookupBy: prev.lookupBy,
        categoryId: prev.categoryId,
        productId: prev.productId,
        costCenterId: prev.costCenterId,
      }));
      setTarget({ kind: "none" });
      await loadLines();
      scanInputRef.current?.focus();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(line: InventoryReportLine): Promise<void> {
    if (!window.confirm(`¿Quitar ${line.tag} de la toma?`)) return;
    try {
      await inventoryCountService.deleteLine(count.id, line.id);
      showSuccessToast(`${line.tag} quitado de la toma`);
      await loadLines();
    } catch (error) {
      handleError(error, navigate);
    }
  }

  async function handleClose(): Promise<void> {
    const created = lines.filter((line) => line.assetCreated).length;
    const message =
      "¿Finalizar la toma de inventario?\n\n" +
      "Se registrarán como no encontrados los activos del sistema que no ingresó y ya no podrá agregar más equipos." +
      (created > 0 ? `\n\nPodrá imprimir ${created} etiqueta(s) nueva(s).` : "");
    if (!window.confirm(message)) return;
    setClosing(true);
    try {
      await inventoryCountService.close(count.id);
      showSuccessToast("Toma de inventario finalizada");
      onClosed();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setClosing(false);
    }
  }

  const linked = target.kind === "linked" ? target.lookup : null;
  // Estados que el combo ofrece: para un activo existente, solo los que la toma acepta.
  const statusOptions = linked
    ? LINE_STATUS_OPTIONS.filter((option) => linked.allowedStatusCodes.includes(option.value))
    : LINE_STATUS_OPTIONS;
  // La serie de un activo existente la define el activo; con busqueda por serie es el valor buscado.
  const serialReadOnly = linked !== null || form.lookupBy === "SERIAL";
  const serialShown = form.lookupBy === "SERIAL" ? form.lookupValue : form.serialNumber;
  // Categoria y producto de un activo que ya los tiene no se cambian desde la toma.
  const productLocked = linked?.productId != null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{count.number}</h2>
          <p className="text-sm text-slate-600">
            Toma abierta · {lines.length} equipo(s) ingresado(s)
          </p>
          {!isAuditor && (
            <p className="mt-1 text-sm text-amber-700">
              Solo el auditor que inició la toma puede ingresar, quitar equipos o cerrarla.
            </p>
          )}
        </div>
        {canEdit && (
          <Button type="button" variant="success" loading={closing} onClick={() => void handleClose()}>
            Fin Inventario
          </Button>
        )}
      </div>

      {canCapture && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
          <fieldset className="mb-3">
            <legend className="mb-1 text-sm font-medium text-slate-700">Identificar el equipo por</legend>
            <div className="flex gap-6">
              {(["TAG", "SERIAL"] as const).map((by) => (
                <label key={by} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="lookupBy"
                    value={by}
                    checked={form.lookupBy === by}
                    onChange={() => handleLookupByChange(by)}
                  />
                  {LOOKUP_LABELS[by]}
                </label>
              ))}
            </div>
          </fieldset>

          <Field
            label={
              form.lookupBy === "TAG"
                ? "TAG (escanee la etiqueta o escríbala y presione Enter)"
                : "N° de serie (escríbalo y presione Enter)"
            }
            htmlFor="lookupValue"
          >
            <div className="flex gap-2">
              <Input
                id="lookupValue"
                ref={scanInputRef}
                placeholder={form.lookupBy === "TAG" ? "ACT000000001" : "N° de serie del equipo"}
                value={form.lookupValue}
                onChange={(e) => handleLookupValueChange(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleLookup();
                  }
                }}
                className={INPUT_CLASS}
                autoComplete="off"
              />
              <Button type="button" variant="secondary" loading={scanning} onClick={() => void handleLookup()}>
                Validar
              </Button>
            </div>
          </Field>

          {linked && (
            <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Activo {linked.tag} encontrado en el sistema (estado actual: {statusLabel(linked.statusCode)}
              {linked.holder ? `, usuario: ${linked.holder.fullName}` : ""}). La toma lo actualizará según el estado y el
              usuario que indique.
            </p>
          )}
          {linked?.instruction && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {linked.instruction}
            </p>
          )}
          {target.kind === "new" && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {form.lookupBy === "TAG" ? `El TAG ${target.value}` : `La serie ${target.value}`} no existe en el sistema. Al
              guardar se creará el activo con una etiqueta nueva generada por el sistema.
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Categoría" htmlFor="category">
              <Select
                id="category"
                value={form.categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
                disabled={productLocked}
                className={INPUT_CLASS}
              >
                <option value="">Seleccione...</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Producto" htmlFor="product">
              <Select
                id="product"
                value={form.productId}
                onChange={(e) => setForm((prev) => ({ ...prev, productId: e.target.value }))}
                disabled={!form.categoryId || loadingProducts || productLocked}
                className={INPUT_CLASS}
              >
                <option value="">
                  {!form.categoryId ? "Seleccione una categoría" : loadingProducts ? "Cargando..." : "Seleccione..."}
                </option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Centro de costo (ubicación)" htmlFor="costCenter">
              <Select
                id="costCenter"
                value={form.costCenterId}
                onChange={(e) => setForm((prev) => ({ ...prev, costCenterId: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="">Seleccione...</option>
                {costCenters.map((costCenter) => (
                  <option key={costCenter.id} value={costCenter.id}>
                    {costCenter.code} · {costCenter.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="N° de serie" htmlFor="serial">
              <Input
                id="serial"
                value={serialShown}
                onChange={(e) => setForm((prev) => ({ ...prev, serialNumber: e.target.value }))}
                readOnly={serialReadOnly}
                disabled={serialReadOnly}
                className={INPUT_CLASS}
                maxLength={100}
              />
            </Field>
            <Field label="Estado" htmlFor="status">
              <Select
                id="status"
                value={form.statusCode}
                onChange={(e) => setForm((prev) => ({ ...prev, statusCode: e.target.value as InventoryLineStatusCode }))}
                disabled={linked?.forcedStatusCode != null}
                className={INPUT_CLASS}
              >
                <option value="">Seleccione...</option>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Descripción" htmlFor="description">
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value.toUpperCase() }))}
                className={INPUT_CLASS}
                maxLength={255}
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label={`Usuario (RUT)${form.statusCode === "ASSIGNED" ? " *" : ""}`}
                htmlFor="holderRut"
              >
                <div className="flex gap-2">
                  <Input
                    id="holderRut"
                    placeholder="12345678-9"
                    value={form.documentId}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, documentId: e.target.value, holderUserId: null, holderName: "" }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleValidateHolder();
                      }
                    }}
                    className={INPUT_CLASS}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    loading={validatingHolder}
                    onClick={() => void handleValidateHolder()}
                  >
                    Validar
                  </Button>
                </div>
              </Field>
              {form.holderUserId !== null && (
                <p className="mt-1 text-sm text-emerald-700">Usuario: {form.holderName}</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button type="button" loading={saving} onClick={() => void handleSubmit()}>
              Agregar equipo
            </Button>
          </div>
        </div>
      )}

      <h2 className="mb-2 text-base font-semibold text-slate-800">Equipos ingresados</h2>
      {loadingLines ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : lines.length === 0 ? (
        <EmptyState title="Sin equipos" description="Aún no se ha ingresado ningún equipo en esta toma." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={TH}>Tag</th>
                <th className={TH}>Producto</th>
                <th className={TH}>N° de serie</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Usuario</th>
                <th className={TH}>Observación</th>
                {canEdit && <th className={TH} />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-2 font-medium text-slate-900">{line.tag}</td>
                  <td className="px-4 py-2 text-slate-600">{line.productName ?? "-"}</td>
                  <td className="px-4 py-2 text-slate-600">{line.serialNumber ?? "-"}</td>
                  <td className="px-4 py-2 text-slate-600">{statusLabel(line.statusCode)}</td>
                  <td className="px-4 py-2 text-slate-600">{line.holder?.fullName ?? "-"}</td>
                  <td className="px-4 py-2">
                    <LineBadges line={line} />
                  </td>
                  {canEdit && (
                    <td className="px-4 py-2 text-right">
                      {/* Solo se quita un equipo que la toma no creo ni modifico. */}
                      {line.removable && (
                        <Button type="button" variant="ghost" onClick={() => void handleRemove(line)}>
                          Quitar
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
