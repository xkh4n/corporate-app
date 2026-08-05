import { AddressModel } from "../../models/mssql/address.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getBusinessPartnerByIdOrThrow } from "./businessPartner.service";
import { getStateByIdOrThrow } from "./state.service";
import { NotFoundError } from "../../library/errors";
import type { AddressCreationAttributes, AddressUpdateAttributes } from "../../types/mssql/address.types";

export async function listAddressesByPerson(personId: number): Promise<AddressModel[]> {
  return AddressModel.findAll({ where: { personId } });
}

export async function listAddressesByBusinessPartner(businessPartnerId: number): Promise<AddressModel[]> {
  return AddressModel.findAll({ where: { businessPartnerId } });
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
