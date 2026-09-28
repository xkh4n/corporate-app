import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";
import { Button, Field, Input, Select } from "../../components/ui";
import { showErrorToast, showSuccessToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { IsRut } from "../../lib/Validations";
import { costCenterService, productCategoryService, productService, purchaseRequestService } from "../../services";
import { servicePortalService } from "../../services/serviceDeskService";
import type { CostCenter, Product, ProductCategory } from "../../types";
import type { SafeUser } from "../../types/user";
import { Loading } from "./components";
import type { EquipmentDraft } from "./equipmentDraft";

// Solicitud de equipo (plan 010): los datos de la compra que el portal envia
// junto con el ticket. Reemplaza a la pantalla "Nueva Solicitud": el
// solicitante es siempre el usuario de la sesion, el beneficiario por defecto
// tambien, y los productos se arman en un carrito como antes.

export function EquipmentRequestFields({ value, onChange }: { value: EquipmentDraft; onChange: (next: EquipmentDraft) => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [approvers, setApprovers] = useState<SafeUser[]>([]);
  const [validating, setValidating] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const nextLineIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      costCenterService.list({ limit: 1000 }),
      productCategoryService.list({ limit: 1000 }),
      productService.list({ limit: 1000 }),
      purchaseRequestService.listApprovers(),
    ])
      .then(([costCentersRes, categoriesRes, productsRes, approversRes]) => {
        if (cancelled) return;
        setCostCenters(costCentersRes.items);
        setCategories(categoriesRes.items);
        setProducts(productsRes.items.filter((product) => product.isActive));
        // Nadie aprueba su propia compra.
        setApprovers(approversRes.filter((approver) => approver.id !== user?.userId));
      })
      .catch((error) => handleError(error, navigate))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [navigate, user?.userId]);

  const set = (patch: Partial<EquipmentDraft>) => onChange({ ...value, ...patch });
  const productsForCategory = products.filter((product) => product.categoryId === categoryId);

  async function validateBeneficiary(): Promise<void> {
    const documentId = value.beneficiaryDocumentId.trim();
    if (!documentId || !IsRut(documentId)) {
      showErrorToast("El RUT no es válido");
      return;
    }
    setValidating(true);
    try {
      const found = await servicePortalService.lookupBeneficiary(documentId);
      set({ beneficiary: found });
      showSuccessToast(`Beneficiario: ${found.fullName}`);
    } catch (error) {
      set({ beneficiary: null });
      handleError(error, navigate);
    } finally {
      setValidating(false);
    }
  }

  function addLine(): void {
    const parsed = Number.parseInt(quantity, 10);
    const product = products.find((item) => item.id === productId);
    const category = categories.find((item) => item.id === categoryId);
    if (!category || !product) {
      showErrorToast("Seleccione el tipo de equipamiento y el producto");
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
      showErrorToast("La cantidad debe ser un número entre 1 y 1000");
      return;
    }
    if (value.lines.length >= 50) {
      showErrorToast("Una solicitud admite hasta 50 productos");
      return;
    }
    set({
      lines: [
        ...value.lines,
        { clientId: String(nextLineIdRef.current++), productId: product.id, productName: product.name, categoryName: category.name, quantity: parsed },
      ],
    });
    setCategoryId("");
    setProductId("");
    setQuantity("1");
  }

  if (loading) return <Loading />;

  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-white p-3">
      <p className="text-sm font-semibold text-slate-700">Datos de la compra</p>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-slate-700">¿Para quién es el equipo?</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="beneficiary" checked={!value.forOther} onChange={() => set({ forOther: false, beneficiary: null, beneficiaryDocumentId: "" })} />
          Para mí{user ? ` (${user.firstName} ${user.lastName})` : ""}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="radio" name="beneficiary" checked={value.forOther} onChange={() => set({ forOther: true })} />
          Para otra persona
        </label>
        {value.forOther && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="RUT de quien lo recibe *" htmlFor="beneficiary-rut">
              <div className="flex gap-2">
                <Input
                  id="beneficiary-rut"
                  maxLength={20}
                  placeholder="Ej: 12.667.399-4"
                  value={value.beneficiaryDocumentId}
                  onChange={(e) => set({ beneficiaryDocumentId: e.target.value, beneficiary: null })}
                  className="bg-zinc-100 focus:bg-indigo-100"
                />
                <Button type="button" variant="secondary" loading={validating} onClick={() => void validateBeneficiary()}>
                  Validar
                </Button>
              </div>
            </Field>
            <Field label="Beneficiario" htmlFor="beneficiary-name">
              <Input id="beneficiary-name" disabled value={value.beneficiary?.fullName ?? ""} placeholder="Se completa al validar el RUT" className="bg-zinc-200 text-zinc-500" />
            </Field>
          </div>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Centro de costo *" htmlFor="cost-center">
          <Select id="cost-center" value={value.costCenterId} onChange={(e) => set({ costCenterId: e.target.value })}>
            <option value="">Seleccione…</option>
            {costCenters.map((costCenter) => (
              <option key={costCenter.id} value={costCenter.id}>
                {costCenter.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Aprueba la compra *" htmlFor="approver">
          <Select id="approver" value={value.approverId} onChange={(e) => set({ approverId: e.target.value })}>
            <option value="">Seleccione…</option>
            {approvers.map((approver) => (
              <option key={approver.id} value={approver.id}>
                {approver.person.firstName} {approver.person.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Correo de contacto" htmlFor="requester-email">
          <Input id="requester-email" type="email" maxLength={150} value={value.requesterEmail} onChange={(e) => set({ requesterEmail: e.target.value.toLowerCase() })} className="bg-zinc-100 focus:bg-indigo-100" />
        </Field>
        <Field label="Teléfono de contacto" htmlFor="requester-phone">
          <Input id="requester-phone" type="tel" maxLength={30} value={value.requesterPhone} onChange={(e) => set({ requesterPhone: e.target.value })} className="bg-zinc-100 focus:bg-indigo-100" />
        </Field>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">Productos *</p>
        <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_auto] sm:items-end">
          <Field label="Tipo de equipamiento" htmlFor="equipment-category">
            <Select
              id="equipment-category"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setProductId("");
              }}
            >
              <option value="">Seleccione…</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Producto" htmlFor="equipment-product">
            <Select id="equipment-product" value={productId} disabled={!categoryId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Seleccione…</option>
              {productsForCategory.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cantidad" htmlFor="equipment-quantity">
            <Input id="equipment-quantity" type="number" min={1} max={1000} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="bg-zinc-100 focus:bg-indigo-100" />
          </Field>
          <Button type="button" variant="success" onClick={addLine}>
            Agregar
          </Button>
        </div>
        {value.lines.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
            {value.lines.map((line) => (
              <li key={line.clientId} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium text-slate-800">{line.productName}</span>{" "}
                  <span className="text-slate-500">
                    · {line.categoryName} · {line.quantity} u.
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Quitar ${line.productName}`}
                  onClick={() => set({ lines: value.lines.filter((item) => item.clientId !== line.clientId) })}
                  className="text-slate-500 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
