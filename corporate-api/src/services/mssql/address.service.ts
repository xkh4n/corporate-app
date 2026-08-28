import { Op, type WhereOptions } from "sequelize";
import { AddressModel } from "../../models/mssql/address.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { getStateByIdOrThrow } from "./state.service";
import { NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildSequelizeOrder, buildSequelizeSearchWhere } from "../../library/sequelizeSearch";
import type { AddressCreationAttributes, AddressUpdateAttributes } from "../../types/mssql/address.types";

const SEARCH_FIELDS = ["addressType", "addressLine"];

async function listAddressesByOwner(
  owner: WhereOptions,
  params: PaginationParams,
): Promise<{ items: AddressModel[]; total: number }> {
  const searchWhere = buildSequelizeSearchWhere(params.search, SEARCH_FIELDS, Op.like);
  const { rows, count } = await AddressModel.findAndCountAll({
    where: { ...owner, ...searchWhere },
    order: buildSequelizeOrder(params.sortBy, params.sortOrder),
    limit: params.limit,
    offset: getOffset(params),
  });
  return { items: rows, total: count };
}

export async function listAddressesByPerson(
  personId: number,
  params: PaginationParams,
): Promise<{ items: AddressModel[]; total: number }> {
  return listAddressesByOwner({ personId }, params);
}

export async function listAddressesByBusinessPartner(
  businessPartnerId: number,
  params: PaginationParams,
): Promise<{ items: AddressModel[]; total: number }> {
  return listAddressesByOwner({ businessPartnerId }, params);
}

export async function getAddressById(id: number): Promise<AddressModel | null> {
  return AddressModel.findByPk(id);
}

export async function getAddressByIdOrThrow(id: number): Promise<AddressModel> {
  const address = await getAddressById(id);
  if (!address) throw new NotFoundError(`La direccion ${id} no existe`);
  return address;
}

// Exactamente uno de personId/businessPartnerId (el CHECK de mssql/migrate.ts
// es la garantia real; esto valida que la referencia elegida exista antes de
// insertar, para un mensaje de error mas claro que un fallo de FK crudo).
export async function createAddress(data: AddressCreationAttributes): Promise<AddressModel> {
  if (data.personId !== undefined) {
    await getPersonByIdOrThrow(data.personId);
  } else {
    await getBusinessPartnerByIdOrThrow(data.businessPartnerId);
  }
  await getStateByIdOrThrow(data.stateId);

  return AddressModel.create(data);
}

export async function updateAddress(id: number, data: AddressUpdateAttributes): Promise<AddressModel> {
  const address = await getAddressByIdOrThrow(id);
  if (data.stateId !== undefined) {
    await getStateByIdOrThrow(data.stateId);
  }
  await address.update(data);
  return address;
}
