import { isValidObjectId } from "mongoose";
import { PositionModel, PositionDocument } from "../../models/mongo/position.model";
import { getRoleByIdOrThrow } from "../postgres/role.service";
import { ConflictError, NotFoundError } from "../../library/errors";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildMongoSearchFilter, buildMongoSort } from "../../library/mongoSearch";
import type { PositionCreationAttributes, PositionUpdateAttributes } from "../../types/mongo/position.types";

const SEARCH_FIELDS = ["title", "description"];

export async function listPositions(
  params: PaginationParams,
): Promise<{ items: PositionDocument[]; total: number }> {
  const filter = buildMongoSearchFilter(params.search, SEARCH_FIELDS);
  const [items, total] = await Promise.all([
    PositionModel.find(filter)
      .sort(buildMongoSort(params.sortBy, params.sortOrder))
      .skip(getOffset(params))
      .limit(params.limit),
    PositionModel.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getPositionById(id: string): Promise<PositionDocument | null> {
  if (!isValidObjectId(id)) return null;
  return PositionModel.findById(id);
}

export async function getPositionByIdOrThrow(id: string): Promise<PositionDocument> {
  const position = await getPositionById(id);
  if (!position) throw new NotFoundError(`El cargo ${id} no existe`);
  return position;
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: number }).code === 11000;
}

export async function createPosition(data: PositionCreationAttributes): Promise<PositionDocument> {
  await getRoleByIdOrThrow(data.roleId);
  try {
    return await PositionModel.create(data);
  } catch (err) {
    if (isMongoDuplicateKeyError(err)) throw new ConflictError(`Ya existe el cargo '${data.title}'`);
    throw err;
  }
}

export async function updatePosition(id: string, data: PositionUpdateAttributes): Promise<PositionDocument> {
  const position = await getPositionByIdOrThrow(id);
  if (data.roleId !== undefined) {
    await getRoleByIdOrThrow(data.roleId);
  }
  position.set(data);
  await position.save();
  return position;
}
