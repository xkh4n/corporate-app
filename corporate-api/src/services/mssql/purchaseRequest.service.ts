import { mssql } from "../../databases/mssql/connection";
import { PurchaseRequestModel } from "../../models/mssql/purchaseRequest.model";
import { PersonModel } from "../../models/mssql/person.model";
import { UserModel } from "../../models/mssql/user.model";
import { getPersonByIdOrThrow } from "./person.service";
import { getUserByIdOrThrow } from "./user.service";
import { getCostCenterByIdOrThrow } from "../postgres/costCenter.service";
import { generateDocumentNumber } from "../../library/documentNumbering";
import { NotFoundError } from "../../library/errors";
import type {
  PurchaseRequestCreationAttributes,
  PurchaseRequestUpdateAttributes,
} from "../../types/mssql/purchaseRequest.types";

const includeParties = [
  { model: PersonModel, as: "requester" },
  { model: PersonModel, as: "beneficiary" },
  { model: UserModel, as: "beneficiaryUser" },
];

export async function listPurchaseRequests(): Promise<PurchaseRequestModel[]> {
  return PurchaseRequestModel.findAll({ include: includeParties, order: [["id", "DESC"]] });
}

export async function getPurchaseRequestById(id: number): Promise<PurchaseRequestModel | null> {
  return PurchaseRequestModel.findByPk(id, { include: includeParties });
}

export async function getPurchaseRequestByIdOrThrow(id: number): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestById(id);
  if (!request) throw new NotFoundError(`La solicitud ${id} no existe`);
  return request;
}

// requestNumber (SOL000000001...) se genera dentro de la MISMA transaccion
// que el insert de la cabecera: si algo despues falla y se hace rollback,
// el numero tambien se revierte -no queda "quemado". Ver
// library/documentNumbering.ts.
export async function createPurchaseRequest(
  data: PurchaseRequestCreationAttributes,
): Promise<PurchaseRequestModel> {
  await getPersonByIdOrThrow(data.requesterId);
  await getPersonByIdOrThrow(data.beneficiaryId);
  if (data.beneficiaryUserId !== undefined && data.beneficiaryUserId !== null) {
    await getUserByIdOrThrow(data.beneficiaryUserId);
  }
  await getCostCenterByIdOrThrow(data.costCenterId);

  const request = await mssql.transaction(async (transaction) => {
    const requestNumber = await generateDocumentNumber("SOL", transaction);
    return PurchaseRequestModel.create({ ...data, requestNumber }, { transaction });
  });

  return getPurchaseRequestByIdOrThrow(request.id);
}

export async function updatePurchaseRequest(
  id: number,
  data: PurchaseRequestUpdateAttributes,
): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(id);
  if (data.beneficiaryUserId !== undefined && data.beneficiaryUserId !== null) {
    await getUserByIdOrThrow(data.beneficiaryUserId);
  }
  await request.update(data);
  return request;
}

const VALID_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "CLOSED", "CANCELLED"] as const;
export type PurchaseRequestStatus = (typeof VALID_STATUSES)[number];

export async function updatePurchaseRequestStatus(
  id: number,
  status: PurchaseRequestStatus,
): Promise<PurchaseRequestModel> {
  const request = await getPurchaseRequestByIdOrThrow(id);
  await request.update({ status });
  return request;
}
