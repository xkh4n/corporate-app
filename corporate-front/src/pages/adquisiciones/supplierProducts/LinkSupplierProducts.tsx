import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RequirePermissions } from "../../../components/RequirePermissions";
import { Field, Button, Select, Spinner } from "../../../components/ui";
import { showSuccessToast } from "../../../components/Toast";
import { handleError } from "../../../lib/Errors";
import { productService, supplierProductService, supplierService } from "../../../services";
import type { Product, Supplier, SupplierProductWithProduct } from "../../../types";

const REQUIRED_PERMISSIONS = [
  "suppliers:read",
  "products:read",
  "supplier-products:read",
  "supplier-products:create",
  "supplier-products:delete",
] as const;

// Vincula que productos vende cada proveedor -sin esto el selector de
// proveedor al cargar una cotizacion (UploadQuotes.tsx) no tiene forma de
// restringirse al producto elegido y muestra el catalogo completo.
export default function LinkSupplierProducts() {
  const navigate = useNavigate();

  const [catalogsLoading, setCatalogsLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [supplierSelected, setSupplierSelected] = useState("");
  const [productSelected, setProductSelected] = useState("");

  // Productos ya vinculados al proveedor seleccionado -se recargan desde el
  // backend cada vez que cambia el proveedor (mismo patron que
  // AsignarPermissionToRole.tsx con los permisos de un rol).
  const [assignedLinks, setAssignedLinks] = useState<SupplierProductWithProduct[]>([]);
  const [loadingAssigned, setLoadingAssigned] = useState(false);

  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [pendingRemoval, setPendingRemoval] = useState<SupplierProductWithProduct | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [supplierRes, productRes] = await Promise.all([
          supplierService.list({ limit: 1000 }),
          productService.list({ limit: 1000 }),
        ]);
        if (cancelled) return;
        setSuppliers(supplierRes.items);
        setProducts(productRes.items.filter((product) => product.isActive));
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

  useEffect(() => {
    if (!supplierSelected) {
      setAssignedLinks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoadingAssigned(true);
        const res = await supplierProductService.listBySupplier(Number(supplierSelected), { limit: 1000 });
        if (cancelled) return;
        setAssignedLinks(res.items);
      } catch (error) {
        handleError(error, navigate);
      } finally {
        if (!cancelled) setLoadingAssigned(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supplierSelected, navigate]);

  const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === supplierSelected);
  const assignedProductIds = new Set(assignedLinks.map((link) => link.productId));
  // No se ofrecen en el combo productos que el proveedor ya tiene vinculados
  // -evita mandar un duplicado que el backend igual rechazaria (409).
  const availableProducts = products.filter((product) => !assignedProductIds.has(product.id));

  function handleSupplierChange(value: string): void {
    setSupplierSelected(value);
    setProductSelected("");
    setPendingProduct(null);
    setPendingRemoval(null);
  }

  function handleProductChange(value: string): void {
    setProductSelected(value);
    const product = products.find((item) => item.id === value) ?? null;
    setPendingProduct(product);
    // Solo una confirmacion a la vez -elegir uno para vincular cancela
    // cualquier "desvincular" que hubiera quedado pendiente.
    setPendingRemoval(null);
  }

  function handleCancelPending(): void {
    setPendingProduct(null);
    setProductSelected("");
  }

  async function handleConfirmPending(): Promise<void> {
    if (!pendingProduct || !supplierSelected) return;
    try {
      setConfirming(true);
      const link = await supplierProductService.create({
        supplierId: Number(supplierSelected),
        productId: pendingProduct.id,
      });
      setAssignedLinks((current) => [...current, { ...link, product: pendingProduct }]);
      showSuccessToast(`Producto "${pendingProduct.name}" vinculado al proveedor exitosamente`);
      setPendingProduct(null);
      setProductSelected("");
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setConfirming(false);
    }
  }

  function handleRequestRemoval(link: SupplierProductWithProduct): void {
    setPendingRemoval(link);
    setPendingProduct(null);
    setProductSelected("");
  }

  function handleCancelRemoval(): void {
    setPendingRemoval(null);
  }

  async function handleConfirmRemoval(): Promise<void> {
    if (!pendingRemoval) return;
    try {
      setRemoving(true);
      await supplierProductService.remove(pendingRemoval.id);
      setAssignedLinks((current) => current.filter((link) => link.id !== pendingRemoval.id));
      showSuccessToast(`Producto "${pendingRemoval.product?.name ?? pendingRemoval.productId}" desvinculado exitosamente`);
      setPendingRemoval(null);
    } catch (error) {
      handleError(error, navigate);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <RequirePermissions all={[...REQUIRED_PERMISSIONS]}>
      <div className="flex flex-col items-center justify-center h-max bg-sky-100 p-4 md:p-5 lg:p-6">
        <h1 className="text-xl md:text-2xl lg:text-3xl font-bold mb-6 text-center text-gray-600">
          Vincular Productos a Proveedor
        </h1>
        {catalogsLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <div className="w-full max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 max-[799px]:grid-cols-1 min-[800px]:grid-cols-6 min-[1000px]:grid-cols-8 min-[1200px]:grid-cols-10 min-[1400px]:grid-cols-12 gap-4">
              {/* PROVEEDOR */}
              <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                <Field label="Proveedor" htmlFor="supplierSelected">
                  <Select
                    id="supplierSelected"
                    className="bg-zinc-100 focus:bg-indigo-100"
                    value={supplierSelected}
                    onChange={(e) => handleSupplierChange(e.target.value)}
                    required
                  >
                    <option value="">Seleccione un Proveedor</option>
                    {suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.businessPartner.legalName}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {/* PRODUCTO */}
              <div className="w-full min-[800px]:col-span-6 min-[1000px]:col-span-8 min-[1200px]:col-span-10 min-[1400px]:col-span-6">
                <Field label="Producto" htmlFor="productToSupplier">
                  <Select
                    id="productToSupplier"
                    className="bg-zinc-100 focus:bg-indigo-100"
                    value={productSelected}
                    onChange={(e) => handleProductChange(e.target.value)}
                    disabled={!supplierSelected || loadingAssigned}
                    required
                  >
                    <option value="">
                      {supplierSelected ? "Seleccione un Producto" : "Primero seleccione el Proveedor"}
                    </option>
                    {availableProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </div>

            {/* CONFIRMACION DEL VINCULO NUEVO */}
            {pendingProduct && selectedSupplier && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="text-sm text-amber-900">
                  ¿Desea vincular el producto <span className="font-semibold">{pendingProduct.name}</span> al
                  proveedor <span className="font-semibold">{selectedSupplier.businessPartner.legalName}</span>?
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={handleCancelPending} disabled={confirming}>
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    loading={confirming}
                    onClick={() => void handleConfirmPending()}
                  >
                    Sí, vincular
                  </Button>
                </div>
              </div>
            )}

            {/* CONFIRMACION PARA DESVINCULAR UN PRODUCTO YA ASIGNADO */}
            {pendingRemoval && selectedSupplier && (
              <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-4">
                <p className="text-sm text-rose-900">
                  ¿Desea desvincular el producto{" "}
                  <span className="font-semibold">{pendingRemoval.product?.name ?? pendingRemoval.productId}</span>{" "}
                  del proveedor <span className="font-semibold">{selectedSupplier.businessPartner.legalName}</span>?
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={handleCancelRemoval} disabled={removing}>
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    className="bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                    loading={removing}
                    onClick={() => void handleConfirmRemoval()}
                  >
                    Sí, desvincular
                  </Button>
                </div>
              </div>
            )}

            {/* PRODUCTOS YA VINCULADOS AL PROVEEDOR */}
            {supplierSelected && (
              <div className="mt-6">
                <h2 className="mb-3 text-sm font-semibold text-slate-700">
                  Productos vinculados a {selectedSupplier?.businessPartner.legalName}
                </h2>
                {loadingAssigned ? (
                  <div className="flex justify-center py-6">
                    <Spinner />
                  </div>
                ) : assignedLinks.length === 0 ? (
                  <p className="text-sm text-slate-500">Este proveedor todavía no tiene productos vinculados.</p>
                ) : (
                  <div className="grid grid-cols-1 min-[800px]:grid-cols-2 min-[1200px]:grid-cols-3 gap-3">
                    {assignedLinks.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                      >
                        <p className="text-sm font-medium text-emerald-900">
                          {link.product?.name ?? link.productId}
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          className="shrink-0 px-2! py-1! text-xs text-rose-600 hover:bg-rose-100"
                          onClick={() => handleRequestRemoval(link)}
                        >
                          Quitar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </RequirePermissions>
  );
}
