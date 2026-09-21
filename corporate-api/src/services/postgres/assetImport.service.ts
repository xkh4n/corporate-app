import { postgres } from "../../databases/postgres/connection";
import { getProductCategoriesByIds } from "../mongo/productCategory.service";
import { getProductById, getProductsByNames } from "../mongo/product.service";
import { findActiveUserIdsByDocumentIds, findActiveUserIdsByUsernames, getUserById } from "../mssql/user.service";
import { createAssetFromInventory, findAssetsBySerial, findExistingSerialTags } from "./asset.service";
import { applyDeclaredStatusToNewAsset, lockAssetSerial } from "./assetIntake.service";
import { getCostCentersByCodes } from "./costCenter.service";
import { BadRequestError, ConflictError, isUniqueConstraintError } from "../../library/errors";
import type { ImportIssue, ParsedImportRow } from "../../library/csvImport";
import type { ResolvedImportRow } from "../../types/postgres/assetImport.types";

// Carga masiva de activos por CSV (plan 005). Este servicio NO conoce Redis: resuelve las filas contra las bases
// (validacion, sin escribir) y da de alta UNA fila en una transaccion Postgres. El estado del trabajo y la
// reanudacion viven en services/redis/assetImportJob.service.ts.

// Un valor del CSV que se repite en un mensaje (nombre de producto, usuario...) se acota: es texto libre de quien
// subio el archivo y el mensaje termina en la respuesta y en el CSV de resultado.
function shown(value: string): string {
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

// Resuelve producto, categoria, centro de costo, usuario y series existentes de TODAS las filas en lote (una
// consulta por origen, no una por fila). Mongo y MSSQL solo se LEEN; nada se escribe. Devuelve las filas resueltas
// (sin problemas) y los problemas de las demas.
export async function resolveImportRows(
  parsed: ParsedImportRow[],
): Promise<{ rows: ResolvedImportRow[]; issues: ImportIssue[] }> {
  const [products, costCenters, usersByName, usersByRut, existingSerials] = await Promise.all([
    getProductsByNames(parsed.map((row) => row.product)),
    getCostCentersByCodes(parsed.map((row) => row.costCenterCode)),
    findActiveUserIdsByUsernames(parsed.flatMap((row) => (row.assignedUsername ? [row.assignedUsername] : []))),
    findActiveUserIdsByDocumentIds(parsed.flatMap((row) => (row.assignedRut ? [row.assignedRut] : []))),
    findExistingSerialTags(parsed.map((row) => row.serialNumber)),
  ]);

  const productByName = new Map(products.map((product) => [product.name, product]));
  const costCenterIdByCode = new Map(costCenters.map((costCenter) => [costCenter.code, costCenter.id]));
  const categoryIds = [...new Set(products.flatMap((product) => (product.categoryId ? [String(product.categoryId)] : [])))];
  const categories = parsed.some((row) => row.category) ? await getProductCategoriesByIds(categoryIds) : [];
  const categoryNameById = new Map(categories.map((category) => [String(category._id), category.name]));

  const rows: ResolvedImportRow[] = [];
  const issues: ImportIssue[] = [];

  for (const row of parsed) {
    const rowIssues: ImportIssue[] = [];
    const fail = (column: string, message: string): void => {
      rowIssues.push({ row: row.row, column, message });
    };

    const product = productByName.get(row.product);
    if (!product) fail("product", `El producto '${shown(row.product)}' no existe (use el nombre exacto)`);
    else {
      if (!product.isActive) fail("product", `El producto '${shown(row.product)}' está inactivo`);
      if (row.category) {
        const categoryName = product.categoryId ? categoryNameById.get(String(product.categoryId)) : undefined;
        if (!categoryName || categoryName.toLowerCase() !== row.category.toLowerCase()) {
          fail("category", `El producto '${shown(row.product)}' no pertenece a la categoría '${shown(row.category)}'`);
        }
      }
    }

    const costCenterId = costCenterIdByCode.get(row.costCenterCode);
    if (costCenterId === undefined) fail("cost_center_code", `El centro de costo ${row.costCenterCode} no existe`);

    // Mismo mensaje para "no existe" e "inactivo", y sin repetir el RUT ni el usuario: validar un archivo no debe servir
    // para averiguar quien es colaborador activo (ademas del presupuesto de identidades no resueltas por usuario).
    let holderUserId: number | null = null;
    if (row.statusCode === "ASSIGNED") {
      if (row.assignedUsername) {
        holderUserId = usersByName.get(row.assignedUsername.toLowerCase()) ?? null;
        if (holderUserId === null) fail("assigned_username", "El usuario indicado no existe o no está activo");
      } else if (row.assignedRut) {
        holderUserId = usersByRut.get(row.assignedRut) ?? null;
        if (holderUserId === null) fail("assigned_rut", "El usuario indicado no existe o no está activo");
      }
    }

    // Misma normalizacion que findExistingSerialTags y que la base (lower + btrim).
    const existingTag = existingSerials.get(row.serialNumber.trim().toLowerCase());
    if (existingTag) fail("serial_number", `Ya existe un activo con esa serie (tag ${existingTag})`);

    if (rowIssues.length > 0 || !product || costCenterId === undefined) {
      issues.push(...rowIssues);
      continue;
    }
    rows.push({
      row: row.row,
      serialNumber: row.serialNumber,
      productId: String(product._id),
      productType: product.productType,
      costCenterId,
      statusCode: row.statusCode,
      holderUserId,
      warrantyExpiresAt: row.warrantyExpiresAt,
    });
  }

  return { rows, issues };
}

const CLOCK_SKEW_TOLERANCE_MS = 60_000;

// Las filas se resuelven al validar y se crean hasta una hora despues (mas lo que dure la carga): antes de crear cada una
// se revalida que el usuario asignado siga activo y que el producto siga activo. La revision del usuario va FUERA de la
// transaccion de la fila (una consulta a MSSQL no debe retener el contador de tags de Postgres). `activeProducts` es una
// cache que el worker descarta cada tantas filas.
export async function assertImportRowStillValid(row: ResolvedImportRow, activeProducts: Map<string, boolean>): Promise<void> {
  if (row.holderUserId !== null) {
    const holder = await getUserById(row.holderUserId);
    if (!holder || !holder.isActive) throw new BadRequestError("El usuario asignado ya no existe o no está activo");
  }
  let productActive = activeProducts.get(row.productId);
  if (productActive === undefined) {
    const product = await getProductById(row.productId);
    productActive = product !== null && product.isActive;
    activeProducts.set(row.productId, productActive);
  }
  if (!productActive) throw new BadRequestError("El producto ya no existe o está inactivo");
}

export interface ImportRowContext {
  jobId: string;
  actorUserId: number;
  jobStartedAt: Date;
  // Verdadero cuando el trabajo ya fue tomado antes por otro worker (una caida, un reinicio o un resume): la fila
  // pudo haberse confirmado en Postgres sin que Redis alcanzara a registrarlo.
  mayAdopt: boolean;
}

// Alta de UNA fila en UNA transaccion Postgres: lock por serie, chequeo de duplicado, alta con tag generado y estado
// declarado (movimiento real si corresponde). Si la fila ya se habia confirmado en un intento anterior (Redis va por
// detras de Postgres) se ADOPTA en vez de rechazarla como duplicada: el activo debe ser el unico con esa serie, del
// mismo usuario, creado despues del inicio del trabajo y con el mismo producto y centro de costo. Como el archivo no
// repite series, solo puede ser de esta fila. Cualquier otro activo con esa serie es un duplicado real.
export async function createAssetForImportRow(
  row: ResolvedImportRow,
  context: ImportRowContext,
): Promise<{ tag: string; adopted: boolean }> {
  try {
    return await postgres.transaction(async (transaction) => {
      await lockAssetSerial(row.serialNumber, transaction);
      const sameSerial = await findAssetsBySerial(row.serialNumber, transaction);
      if (sameSerial.length > 0) {
        const existing = sameSerial[0]!;
        // Ademas de autor, momento, producto y centro de costo se compara todo lo que la fila fija (garantia y estado): un
        // activo creado por otra via con la misma serie no se da por hecho de esta fila. El momento tiene una tolerancia
        // por desfase de reloj entre replicas (createdAt lo pone la replica que creo el activo; startedAt, la que inicio).
        const isOwnEarlierWrite =
          context.mayAdopt &&
          sameSerial.length === 1 &&
          existing.createdBy === context.actorUserId &&
          existing.createdAt.getTime() >= context.jobStartedAt.getTime() - CLOCK_SKEW_TOLERANCE_MS &&
          existing.productId === row.productId &&
          existing.costCenterId === row.costCenterId &&
          (existing.warrantyExpiresAt ?? null) === row.warrantyExpiresAt &&
          existing.status?.code === row.statusCode;
        if (isOwnEarlierWrite) return { tag: existing.tag, adopted: true };
        throw new ConflictError(`Ya existe un activo con esa serie (tag ${existing.tag})`);
      }

      const asset = await createAssetFromInventory(
        {
          productId: row.productId,
          productType: row.productType,
          costCenterId: row.costCenterId,
          serialNumber: row.serialNumber,
          warrantyExpiresAt: row.warrantyExpiresAt,
          createdBy: context.actorUserId,
        },
        transaction,
      );
      await applyDeclaredStatusToNewAsset(
        asset.id,
        row.statusCode,
        row.holderUserId,
        `Carga masiva ${context.jobId} fila ${row.row}`,
        context.actorUserId,
        transaction,
      );
      return { tag: asset.tag, adopted: false };
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new ConflictError("Conflicto al generar el activo; reintente la fila");
    throw err;
  }
}
