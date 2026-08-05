import { CustomerModel } from "../../models/mssql/customer.model";
import { BusinessPartnerModel } from "../../models/mssql/businessPartner.model";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { CustomerCreationAttributes } from "../../types/mssql/customer.types";

export async function listCustomers(): Promise<CustomerModel[]> {
  return CustomerModel.findAll({ include: [{ model: BusinessPartnerModel, as: "businessPartner" }] });
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
