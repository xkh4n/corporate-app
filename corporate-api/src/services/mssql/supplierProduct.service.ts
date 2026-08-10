import { SupplierModel } from "../../models/mssql/supplier.model";
import { SupplierProductModel } from "../../models/mssql/supplierProduct.model";
import { getSupplierByIdOrThrow, getSuppliersByIds } from "./supplier.service";
import { getProductByIdOrThrow, getProductsByIds } from "../mongo/product.service";
import type { ProductDocument } from "../../models/mongo/product.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { SupplierProductCreationAttributes } from "../../types/mssql/supplierProduct.types";

export interface SupplierProductWithProduct {
  id: number;
  supplierId: number;
  productId: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  product: ProductDocument | null;
}

export interface SupplierProductWithSupplier {
  id: number;
  supplierId: number;
  productId: string;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  supplier: SupplierModel | null;
}

// productId es cross-engine (Mongo): no se puede resolver con un include de
// Sequelize como businessPartner/serviceType/deliveryTerms en Supplier. Se
// embebe a mano -a diferencia del resto de las referencias cross-engine de
// este proyecto (que solo validan y devuelven el id crudo)- porque el unico
// motivo de este endpoint es poblar un selector en el frontend: un listado de
// ids sin nombre no serviria para eso. Batch (una query para todas las filas,
// no una por fila) via getProductsByIds/getSuppliersByIds -evita N+1.
function attachProducts(
  rows: SupplierProductModel[],
  products: ProductDocument[],
): SupplierProductWithProduct[] {
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  return rows.map((row) => {
    const plain = row.get({ plain: true });
    return { ...plain, product: productsById.get(plain.productId) ?? null };
  });
}

// getSupplierByIdOrThrow ya embebe businessPartner/serviceType/deliveryTerms
// (mismo motor, include de Sequelize) -getSuppliersByIds reusa el mismo
// INCLUDE, sin duplicar ese armado aca.
function attachSuppliers(
  rows: SupplierProductModel[],
  suppliers: SupplierModel[],
): SupplierProductWithSupplier[] {
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  return rows.map((row) => {
    const plain = row.get({ plain: true });
    return { ...plain, supplier: suppliersById.get(plain.supplierId) ?? null };
  });
}

export async function listProductsBySupplier(
  supplierId: number,
  params: PaginationParams,
): Promise<{ items: SupplierProductWithProduct[]; total: number }> {
  await getSupplierByIdOrThrow(supplierId);

  const { rows, count } = await SupplierProductModel.findAndCountAll({
    where: { supplierId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  const products = await getProductsByIds(rows.map((row) => row.productId));
  return { items: attachProducts(rows, products), total: count };
}

// Direccion inversa: dado un producto (ya elegido en la linea de solicitud),
// listar los proveedores que lo tienen vinculado -para poblar el selector de
// "proveedor" al crear una Quote (createQuoteSchema exige supplierId).
export async function listSuppliersByProduct(
  productId: string,
  params: PaginationParams,
): Promise<{ items: SupplierProductWithSupplier[]; total: number }> {
  await getProductByIdOrThrow(productId);

  const { rows, count } = await SupplierProductModel.findAndCountAll({
    where: { productId },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  const suppliers = await getSuppliersByIds(rows.map((row) => row.supplierId));
  return { items: attachSuppliers(rows, suppliers), total: count };
}

export async function getSupplierProductByIdOrThrow(id: number): Promise<SupplierProductModel> {
  const link = await SupplierProductModel.findByPk(id);
  if (!link) throw new NotFoundError(`El vinculo proveedor-producto ${id} no existe`);
  return link;
}

export async function linkSupplierProduct(
  data: SupplierProductCreationAttributes,
): Promise<SupplierProductWithProduct> {
  await getSupplierByIdOrThrow(data.supplierId);
  const product = await getProductByIdOrThrow(data.productId);

  const existing = await SupplierProductModel.findOne({
    where: { supplierId: data.supplierId, productId: data.productId },
  });
  if (existing) throw new ConflictError("Ese proveedor ya tiene vinculado ese producto");

  const link = await SupplierProductModel.create(data);
  return attachProducts([link], [product])[0]!;
}

export async function unlinkSupplierProduct(id: number): Promise<void> {
  const link = await getSupplierProductByIdOrThrow(id);
  await link.destroy();
}
