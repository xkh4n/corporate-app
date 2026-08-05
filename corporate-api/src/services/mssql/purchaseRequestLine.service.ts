import { PurchaseRequestLineModel } from "../../models/mssql/purchaseRequestLine.model";
import { getPurchaseRequestByIdOrThrow } from "./purchaseRequest.service";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { getProductByIdOrThrow } from "../mongo/product.service";
import { NotFoundError } from "../../library/errors";
import type {
  PurchaseRequestLineCreationAttributes,
  PurchaseRequestLineUpdateAttributes,
} from "../../types/mssql/purchaseRequestLine.types";

export async function listLinesByRequest(requestId: number): Promise<PurchaseRequestLineModel[]> {
  return PurchaseRequestLineModel.findAll({ where: { requestId }, order: [["id", "ASC"]] });
}

export async function getLineById(id: number): Promise<PurchaseRequestLineModel | null> {
  return PurchaseRequestLineModel.findByPk(id);
}

export async function getLineByIdOrThrow(id: number): Promise<PurchaseRequestLineModel> {
  const line = await getLineById(id);
  if (!line) throw new NotFoundError(`La linea de solicitud ${id} no existe`);
  return line;
}

// productId es un ObjectId de Mongo (catalogo de producto) -sin FK real,
// validado a mano contra el service de Mongo, mismo criterio que
// getRoleByIdOrThrow en user.service.ts para el cross-engine hacia Postgres.
export async function createLine(
  data: PurchaseRequestLineCreationAttributes,
): Promise<PurchaseRequestLineModel> {
  await getPurchaseRequestByIdOrThrow(data.requestId);
  await getProductByIdOrThrow(data.productId);
  if (data.supplierId !== undefined && data.supplierId !== null) {
    await getSupplierByIdOrThrow(data.supplierId);
  }

  return PurchaseRequestLineModel.create(data);
}

export async function updateLine(
  id: number,
  data: PurchaseRequestLineUpdateAttributes,
): Promise<PurchaseRequestLineModel> {
  const line = await getLineByIdOrThrow(id);
  if (data.supplierId !== undefined && data.supplierId !== null) {
    await getSupplierByIdOrThrow(data.supplierId);
  }
  await line.update(data);
  return line;
}
