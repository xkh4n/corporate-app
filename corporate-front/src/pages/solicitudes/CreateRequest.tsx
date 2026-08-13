import { useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../components/RequirePermissions";
import { Spinner, Field, Select, Button, Input, Textarea } from "../../components/ui";
import { showSuccessToast, showErrorToast } from "../../components/Toast";
import { handleError } from "../../lib/Errors";
import { createValidationError } from "../../lib/Errors/CustomError";
import { IsEmail, IsParagraph, IsPhone, IsRut } from "../../lib/Validations";
import { useAuth } from "../../auth/useAuth";
import {
  costCenterService,
  productService,
  productCategoryService,
  personService,
  purchaseRequestService,
  purchaseRequestLineService,
} from "../../services";
import type { CostCenter, Product, ProductCategory } from "../../types";
import type { SafeUser } from "../../types/user";

// Ademas de "purchase-requests:create" (crea la solicitud/cabecera), hace
// falta "purchase-request-lines:create" para poder completar el flujo
// entero: sin el, el segundo POST (agregar los productos a la solicitud) da
// 403 a mitad de camino -mismo criterio que CrearPersona.tsx.
const REQUIRED_PERMISSIONS = ["purchase-requests:create", "purchase-request-lines:create"] as const;

interface RequestLineDraft {
  clientId: string;
  productId: string;
  productName: string;
  quantity: number;
  equipmentType: string;
}

export default function CreateRequest() {
  const navigate = useNavigate();
  // El solicitante no se elige: siempre es quien tiene la sesion abierta
  // -no se puede generar una solicitud a nombre de otro usuario.
  const { user } = useAuth();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [approvers, setApprovers] = useState<SafeUser[]>([]);

  const [costCenterId, setCostCenterId] = useState("");
  const [approverId, setApproverId] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPhone, setRequesterPhone] = useState("");
  const [notes, setNotes] = useState("");

  // El beneficiario se busca por RUT y solo queda "confirmado" (beneficiaryId
  // no nulo) si personService.findByDocumentId encuentra a alguien -editar el
  // RUT despues de validado limpia la confirmacion, para no mandar un id que
  // ya no corresponde con lo que se ve en pantalla.
  const [beneficiaryDocumentId, setBeneficiaryDocumentId] = useState("");
  const [beneficiaryId, setBeneficiaryId] = useState<number | null>(null);
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [validatingBeneficiary, setValidatingBeneficiary] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [lines, setLines] = useState<RequestLineDraft[]>([]);
  const nextLineIdRef = useRef(0);

  const [submitting, setSubmitting] = useState(false);

  // Id de la solicitud ya creada en un intento previo que fallo a mitad de
  // camino (mismo criterio que createBusinessPartner.tsx/CrearPersona.tsx):
  // sin esto, un segundo submit despues de que fallara solo el envio de
  // algunas lineas volveria a crear la solicitud entera.
  const [requestId, setRequestId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [costCentersRes, categoriesRes, productsRes, approversRes] = await Promise.all([
          costCenterService.list({ limit: 1000 }),
          productCategoryService.list({ limit: 1000 }),
          productService.list({ limit: 1000 }),
          purchaseRequestService.listApprovers(),
        ]);
        if (cancelled) return;
        setCostCenters(costCentersRes.items);
        setCategories(categoriesRes.items);
        setProducts(productsRes.items.filter((product) => product.isActive));
        setApprovers(approversRes);
      } catch (error) {
        handleError(error, navigate);
      } finally {
        if (!cancelled) setCatalogsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const productsForCategory = products.filter((product) => product.categoryId === selectedCategoryId);

  function handleCategoryChange(value: string): void {
    setSelectedCategoryId(value);
    setSelectedProductId("");
  }

  function handleBeneficiaryDocumentIdChange(value: string): void {
    setBeneficiaryDocumentId(value);
    setBeneficiaryId(null);
    setBeneficiaryName("");
  }

  async function handleValidateBeneficiary(): Promise<void> {
    const documentId = beneficiaryDocumentId.trim();
    if (!documentId || !IsRut(documentId)) {
      showErrorToast("El RUT del beneficiario no es valido");
      return;
    }
    setValidatingBeneficiary(true);
    try {
      const res = await personService.findByDocumentId(documentId);
      const found = res.items[0];
      if (!found) {
        showErrorToast("No existe una persona con ese RUT");
        setBeneficiaryId(null);
        setBeneficiaryName("");
        return;
      }
      setBeneficiaryId(found.id);
      setBeneficiaryName(`${found.firstName} ${found.lastName}`);
      showSuccessToast("Beneficiario encontrado");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setValidatingBeneficiary(false);
    }
  }

  function resetForm() {
    setCostCenterId("");
    setApproverId("");
    setRequesterEmail("");
    setRequesterPhone("");
    setNotes("");
    setBeneficiaryDocumentId("");
    setBeneficiaryId(null);
    setBeneficiaryName("");
    setSelectedCategoryId("");
    setSelectedProductId("");
    setQuantity("");
    setLines([]);
    setRequestId(null);
  }

  function handleAddLine(): void {
    if (!selectedCategoryId) {
      showErrorToast("Debe seleccionar el tipo de equipamiento");
      return;
    }
    if (!selectedProductId) {
      showErrorToast("Debe seleccionar un producto");
      return;
    }
    const parsedQuantity = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      showErrorToast("La cantidad debe ser un numero mayor a cero");
      return;
    }
    const category = categories.find((item) => item.id === selectedCategoryId);
    const product = products.find((item) => item.id === selectedProductId);
    if (!category || !product) {
      showErrorToast("El producto seleccionado ya no esta disponible");
      return;
    }

    setLines((prev) => [
      ...prev,
      {
        clientId: String(nextLineIdRef.current++),
        productId: product.id,
        productName: product.name,
        quantity: parsedQuantity,
        equipmentType: category.name,
      },
    ]);
    setSelectedCategoryId("");
    setSelectedProductId("");
    setQuantity("");
  }

  function removeLine(clientId: string): void {
    setLines((prev) => prev.filter((line) => line.clientId !== clientId));
  }

  function validate(): void {
    if (!costCenterId) throw createValidationError("Debe seleccionar el centro de costo");
    if (!approverId) throw createValidationError("Debe seleccionar el aprobador");
    if (!beneficiaryId) throw createValidationError("Debe validar el RUT del beneficiario");
    if (requesterEmail.trim() && !IsEmail(requesterEmail.trim())) {
      throw createValidationError("El correo del solicitante no es valido");
    }
    if (requesterPhone.trim() && !IsPhone(requesterPhone.trim())) {
      throw createValidationError("El telefono del solicitante no es valido");
    }
    if (notes.trim() && !IsParagraph(notes.trim())) {
      throw createValidationError("Las observaciones no son validas");
    }
    if (lines.length === 0) {
      throw createValidationError("Debe agregar al menos un producto a la solicitud");
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setSubmitting(true);
    try {
      validate();

      // validate() ya garantiza que beneficiaryId no es null; se vuelve a
      // capturar en una constante local para que TS lo siga viendo asi
      // despues de los await de mas abajo.
      const confirmedBeneficiaryId = beneficiaryId;
      if (confirmedBeneficiaryId === null) {
        throw createValidationError("Debe validar el RUT del beneficiario");
      }

      let rId = requestId;
      if (!rId) {
        const request = await purchaseRequestService.create({
          requesterId: user.personId,
          beneficiaryId: confirmedBeneficiaryId,
          costCenterId: Number(costCenterId),
          approverId: Number(approverId),
          requesterPosition: user.roleName,
          requesterEmail: requesterEmail.trim() || undefined,
          requesterPhone: requesterPhone.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        rId = request.id;
        setRequestId(rId);
      }

      // Se envian las lineas pendientes en orden, sacando cada una del
      // carrito apenas se confirma: si una falla a mitad de camino, un
      // reintento solo vuelve a mandar las que quedaron en el state.
      const pendingLines = [...lines];
      for (const line of pendingLines) {
        await purchaseRequestLineService.create({
          requestId: rId,
          productId: line.productId,
          quantity: line.quantity,
          equipmentType: line.equipmentType || undefined,
        });
        setLines((prev) => prev.filter((item) => item.clientId !== line.clientId));
      }

      showSuccessToast(`Solicitud creada exitosamente con ${pendingLines.length} producto(s)`);
      resetForm();
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">Nueva Solicitud</h1>

        {catalogsLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
            <form onSubmit={(event) => void handleSubmit(event)} className="w-full">
              <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                {/* SOLICITANTE (usuario logeado, solo lectura) */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                  <Field label="Solicitante" htmlFor="requesterDisplay">
                    <Input
                      id="requesterDisplay"
                      value={user ? `${user.firstName.toUpperCase()} ${user.lastName.toUpperCase()}` : ""}
                      disabled
                      className="bg-zinc-200 text-zinc-500"
                    />
                  </Field>
                </div>
                {/* CARGO SOLICITANTE (rol del usuario logeado, solo lectura) */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                  <Field label="Cargo del Solicitante" htmlFor="requesterPositionDisplay">
                    <Input
                      id="requesterPositionDisplay"
                      value={user?.roleName.toUpperCase() ?? ""}
                      disabled
                      className="bg-zinc-200 text-zinc-500"
                    />
                  </Field>
                </div>
                {/* RUT BENEFICIARIO */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                  <Field label="RUT Beneficiario" htmlFor="beneficiaryDocumentId">
                    <div className="flex gap-2">
                      <Input
                        id="beneficiaryDocumentId"
                        value={beneficiaryDocumentId}
                        maxLength={20}
                        placeholder="Ej: 12.667.399-4"
                        onChange={(e) => handleBeneficiaryDocumentIdChange(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        loading={validatingBeneficiary}
                        onClick={() => void handleValidateBeneficiary()}
                      >
                        Validar
                      </Button>
                    </div>
                  </Field>
                </div>
                {/* BENEFICIARIO (se completa al validar el RUT) */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-3">
                  <Field label="Beneficiario" htmlFor="beneficiaryName">
                    <Input
                      id="beneficiaryName"
                      value={beneficiaryName}
                      placeholder="Se completa al validar el RUT"
                      disabled
                      className="bg-zinc-200 text-zinc-500"
                    />
                  </Field>
                </div>
                {/* CENTRO DE COSTO */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-4 min-[1200px]:col-span-2 min-[1400px]:col-span-4">
                  <Field label="Centro de Costo" htmlFor="costCenterId">
                    <Select
                      id="costCenterId"
                      className="bg-zinc-100 focus:bg-indigo-100"
                      value={costCenterId}
                      onChange={(e) => setCostCenterId(e.target.value)}
                      required
                    >
                      <option value="">Seleccione el centro de costo</option>
                      {costCenters.map((costCenter) => (
                        <option key={costCenter.id} value={costCenter.id}>
                          {costCenter.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {/* APROBADOR */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                  <Field label="Aprobador" htmlFor="approverId">
                    <Select
                      id="approverId"
                      className="bg-zinc-100 focus:bg-indigo-100"
                      value={approverId}
                      onChange={(e) => setApproverId(e.target.value)}
                      required
                    >
                      <option value="">Seleccione el aprobador</option>
                      {approvers.map((approver) => (
                        <option key={approver.id} value={approver.id}>
                          {approver.person.firstName} {approver.person.lastName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {/* EMAIL SOLICITANTE */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                  <Field label="Correo del Solicitante" htmlFor="requesterEmail">
                    <Input
                      id="requesterEmail"
                      type="email"
                      value={requesterEmail}
                      maxLength={150}
                      onChange={(e) => setRequesterEmail(e.target.value.toLowerCase())}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                </div>
                {/* TELEFONO SOLICITANTE */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                  <Field label="Telefono del Solicitante" htmlFor="requesterPhone">
                    <Input
                      id="requesterPhone"
                      type="tel"
                      value={requesterPhone}
                      maxLength={30}
                      onChange={(e) => setRequesterPhone(e.target.value)}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                </div>
                {/* OBSERVACIONES */}
                <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-12">
                  <Field label="Observaciones" htmlFor="notes">
                    <Textarea
                      id="notes"
                      value={notes}
                      maxLength={500}
                      rows={4}
                      onChange={(e) => setNotes(e.target.value.toUpperCase())}
                      className="bg-zinc-100 focus:bg-indigo-100"
                    />
                  </Field>
                </div>
              </div>

              {/* AGREGAR PRODUCTO */}
              <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="mb-3 text-sm font-semibold text-slate-600">Agregar Producto</h2>
                <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
                  <div className="w-full max-[799px]:w-full min-[800px]:col-span-3 min-[1000px]:col-span-4 min-[1200px]:col-span-4 min-[1400px]:col-span-5">
                    <Field label="Tipo de Equipamiento" htmlFor="selectedCategoryId">
                      <Select
                        id="selectedCategoryId"
                        className="bg-zinc-100 focus:bg-indigo-100"
                        value={selectedCategoryId}
                        onChange={(e) => handleCategoryChange(e.target.value)}
                      >
                        <option value="">Seleccione el tipo de equipamiento</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="w-full max-[799px]:w-full min-[800px]:col-span-2 min-[1000px]:col-span-3 min-[1200px]:col-span-3 min-[1400px]:col-span-4">
                    <Field label="Producto" htmlFor="selectedProductId">
                      <Select
                        id="selectedProductId"
                        className="bg-zinc-100 focus:bg-indigo-100"
                        value={selectedProductId}
                        onChange={(e) => setSelectedProductId(e.target.value)}
                        disabled={!selectedCategoryId}
                      >
                        <option value="">Seleccione el producto</option>
                        {productsForCategory.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="w-full max-[799px]:w-full min-[800px]:col-span-1 min-[1000px]:col-span-1 min-[1200px]:col-span-1 min-[1400px]:col-span-1">
                    <Field label="Cantidad" htmlFor="quantity">
                      <Input
                        id="quantity"
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        className="bg-zinc-100 focus:bg-indigo-100"
                      />
                    </Field>
                  </div>
                  <div className="w-full max-[799px]:w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-2 min-[1400px]:col-span-2 flex items-end">
                    <Button type="button" variant="success" onClick={handleAddLine} className="w-full">
                      Agregar
                    </Button>
                  </div>
                </div>
              </div>

              {/* TABLA DE PRODUCTOS AGREGADOS */}
              {lines.length > 0 && (
                <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Producto</th>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Tipo de Equipamiento</th>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Cantidad</th>
                        <th className="px-4 py-2 text-left font-semibold text-slate-600">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {lines.map((line) => (
                        <tr key={line.clientId}>
                          <td className="px-4 py-2 font-medium text-slate-900">{line.productName}</td>
                          <td className="px-4 py-2 text-slate-600">{line.equipmentType || "-"}</td>
                          <td className="px-4 py-2 text-slate-600">{line.quantity}</td>
                          <td className="px-4 py-2">
                            <button
                              type="button"
                              onClick={() => removeLine(line.clientId)}
                              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
                            >
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-1 row-auto justify-center mt-6">
                <Button type="submit" loading={submitting} disabled={lines.length === 0} className="w-60">
                  Guardar
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </RequirePermissions>
  );
}
