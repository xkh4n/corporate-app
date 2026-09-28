import { isValidObjectId } from "mongoose";
import { ProductCategoryModel, ProductCategoryDocument } from "../../models/mongo/productCategory.model";
import { ConflictError, NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildMongoSearchFilter, buildMongoSort } from "../../library/mongoSearch";
import type {
  ProductCategoryCreationAttributes,
  ProductCategoryUpdateAttributes,
} from "../../types/mongo/productCategory.types";

const SEARCH_FIELDS = ["name", "description"];

export async function listProductCategories(
  params: PaginationParams,
): Promise<{ items: ProductCategoryDocument[]; total: number }> {
  const filter = buildMongoSearchFilter(params.search, SEARCH_FIELDS);
  const [items, total] = await Promise.all([
    ProductCategoryModel.find(filter)
      .sort(buildMongoSort(params.sortBy, params.sortOrder))
      .skip(getOffset(params))
      .limit(params.limit),
    ProductCategoryModel.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getProductCategoryById(id: string): Promise<ProductCategoryDocument | null> {
  if (!isValidObjectId(id)) return null;
  return ProductCategoryModel.findById(id);
}

export async function getProductCategoryByIdOrThrow(id: string): Promise<ProductCategoryDocument> {
  const category = await getProductCategoryById(id);
  if (!category) throw new NotFoundError(`La categoria de producto ${id} no existe`);
  return category;
}

// Batch por ids -evita N+1 al resolver la categoria de varios productos a la
// vez (ver getQuoteRequestDocumentData en purchaseRequest.service.ts).
export async function getProductCategoriesByIds(ids: string[]): Promise<ProductCategoryDocument[]> {
  const validIds = ids.filter((id) => isValidObjectId(id));
  if (validIds.length === 0) return [];
  return ProductCategoryModel.find({ _id: { $in: validIds } });
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: number }).code === 11000;
}

export async function createProductCategory(
  data: ProductCategoryCreationAttributes,
): Promise<ProductCategoryDocument> {
  try {
    return await ProductCategoryModel.create(data);
  } catch (err) {
    if (isMongoDuplicateKeyError(err)) throw new ConflictError(`Ya existe la categoria '${data.name}'`);
    throw err;
  }
}

export async function updateProductCategory(
  id: string,
  data: ProductCategoryUpdateAttributes,
): Promise<ProductCategoryDocument> {
  const category = await getProductCategoryByIdOrThrow(id);
  category.set(data);
  await category.save();
  return category;
}

// Categorias reales del negocio (dadas por el usuario), sembradas una sola
// vez en el primer arranque. Los productos no se siembran: el catalogo nace vacio.
const INITIAL_CATEGORIES = [
  { name: "IMPRESORAS LASER", description: "Impresoras laser de oficina" },
  { name: "IMPRESORAS TERMALES 80MM", description: "Impresoras termicas de rollo 80mm (boletas/tickets)" },
  { name: "IMPRESORAS TERMALES 104MM", description: "Impresoras termicas de rollo 104mm (boletas/tickets)" },
  { name: "IMPRESORAS TERMAL MULTIFUNCIONAL", description: "Impresoras termicas multifuncionales" },
  { name: "NOTEBOOKS", description: "Computadores portatiles" },
  { name: "DESKTOPS", description: "Computadores de escritorio" },
  { name: "IMPRESORAS ZEBRA", description: "Impresoras de etiquetas Zebra" },
  { name: "SMARTPHONE", description: "Telefonos moviles inteligentes" },
  { name: "TECLADOS", description: "Teclados" },
  { name: "MOUSE", description: "Mouse/raton" },
  { name: "SWITCH", description: "Switches de red" },
];

export async function seedProductCategories(): Promise<void> {
  const existing = await ProductCategoryModel.countDocuments();
  if (existing > 0) return;

  try {
    await ProductCategoryModel.create(INITIAL_CATEGORIES);
    logger.info("Seed de product_categories aplicado");
  } catch (err) {
    if (!isMongoDuplicateKeyError(err)) throw err;
    logger.debug("Seed de product_categories ya aplicado por otra replica, se omite");
  }
}
