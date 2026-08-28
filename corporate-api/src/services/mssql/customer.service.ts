import { CustomerModel } from "../../models/mssql/customer.model";
import { BusinessPartnerModel } from "../../models/mssql/businessPartner.model";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder } from "../../library/sequelizeSearch";
import type { CustomerCreationAttributes } from "../../types/mssql/customer.types";

// Sin campos de texto propios (solo el FK a businessPartner): no hay filtro
// de busqueda de texto libre, solo paginacion/orden.
export async function listCustomers(
  params: PaginationParams,
): Promise<{ items: CustomerModel[]; total: number }> {
  const { rows, count } = await CustomerModel.findAndCountAll({
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
    include: [{ model: BusinessPartnerModel, as: "businessPartner" }],
  });
  return { items: rows, total: count };
}

export async function getCustomerById(id: number): Promise<CustomerModel | null> {
  return CustomerModel.findByPk(id, { include: [{ model: BusinessPartnerModel, as: "businessPartner" }] });
}

export async function getCustomerByIdOrThrow(id: number): Promise<CustomerModel> {
  const customer = await getCustomerById(id);
  if (!customer) throw new NotFoundError(`El cliente ${id} no existe`);
  return customer;
}

export async function getCustomerByBusinessPartnerId(businessPartnerId: number): Promise<CustomerModel | null> {
  return CustomerModel.findOne({ where: { businessPartnerId } });
}

export async function createCustomer(data: CustomerCreationAttributes): Promise<CustomerModel> {
  await getBusinessPartnerByIdOrThrow(data.businessPartnerId);

  const existing = await getCustomerByBusinessPartnerId(data.businessPartnerId);
  if (existing) throw new ConflictError(`El tercero ${data.businessPartnerId} ya es cliente`);

  const customer = await CustomerModel.create(data);
  return getCustomerByIdOrThrow(customer.id);
}
