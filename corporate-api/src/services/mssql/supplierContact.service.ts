import { Op } from "sequelize";
import { SupplierContactModel } from "../../models/mssql/supplierContact.model";
import { getSupplierByIdOrThrow } from "./supplier.service";
import { NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type {
  SupplierContactCreationAttributes,
  SupplierContactUpdateAttributes,
} from "../../types/mssql/supplierContact.types";

const SEARCH_FIELDS = ["name", "email", "position"];

export async function listContactsBySupplier(
  supplierId: number,
  params: PaginationParams,
): Promise<{ items: SupplierContactModel[]; total: number }> {
  await getSupplierByIdOrThrow(supplierId);

  const searchWhere = buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like);
  const { rows, count } = await SupplierContactModel.findAndCountAll({
    where: { supplierId, ...searchWhere },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

// Todos los contactos de un proveedor, sin paginar -usado para armar la
// lista de destinatarios al enviar la "solicitud de cotizacion" por correo
// (no hay campo "principal" en el modelo, se manda a todos).
export async function listAllContactsBySupplier(supplierId: number): Promise<SupplierContactModel[]> {
  return SupplierContactModel.findAll({ where: { supplierId }, order: [["id", "ASC"]] });
}

export async function getSupplierContactById(id: number): Promise<SupplierContactModel | null> {
  return SupplierContactModel.findByPk(id);
}

export async function getSupplierContactByIdOrThrow(id: number): Promise<SupplierContactModel> {
  const contact = await getSupplierContactById(id);
  if (!contact) throw new NotFoundError(`El contacto ${id} no existe`);
  return contact;
}

export async function createSupplierContact(
  data: SupplierContactCreationAttributes,
): Promise<SupplierContactModel> {
  await getSupplierByIdOrThrow(data.supplierId);
  return SupplierContactModel.create(data);
}

export async function updateSupplierContact(
  id: number,
  data: SupplierContactUpdateAttributes,
): Promise<SupplierContactModel> {
  const contact = await getSupplierContactByIdOrThrow(id);
  await contact.update(data);
  return contact;
}

export async function deleteSupplierContact(id: number): Promise<void> {
  const contact = await getSupplierContactByIdOrThrow(id);
  await contact.destroy();
}
