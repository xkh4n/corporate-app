import path from "node:path";
import { isValidObjectId } from "mongoose";
import { ProductModel, ProductDocument } from "../../models/mongo/product.model";
import { getProductCategoryByIdOrThrow } from "./productCategory.service";
import { NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
import { getSafeExtension } from "../../middlewares/upload";
import { getProductImagesFolder, saveBuffer, deleteIfExists } from "../../library/documentStorage";
import type { PaginationParams } from "../../library/pagination";
import { getOffset } from "../../library/pagination";
import { buildMongoSearchFilter, buildMongoSort } from "../../library/mongoSearch";
import type { ProductCreationAttributes, ProductUpdateAttributes } from "../../types/mongo/product.types";

const SEARCH_FIELDS = ["name", "description"];

// categoryId opcional: usado por el combo dependiente categoria -> producto de
// la toma de inventario (corporate-front, pages/inventario). Un id mal formado
// se rechaza en el controller, aca ya llega validado.
export async function listProducts(
  params: PaginationParams,
  categoryId?: string,
): Promise<{ items: ProductDocument[]; total: number }> {
  const filter = { ...buildMongoSearchFilter(params.search, SEARCH_FIELDS), ...(categoryId ? { categoryId } : {}) };
  const [items, total] = await Promise.all([
    ProductModel.find(filter)
      .sort(buildMongoSort(params.sortBy, params.sortOrder))
      .skip(getOffset(params))
      .limit(params.limit),
    ProductModel.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getProductById(id: string): Promise<ProductDocument | null> {
  if (!isValidObjectId(id)) return null;
  return ProductModel.findById(id);
}

export async function getProductByIdOrThrow(id: string): Promise<ProductDocument> {
  const product = await getProductById(id);
  if (!product) throw new NotFoundError(`El producto ${id} no existe`);
  return product;
}

// Batch por ids -evita N+1 al listar productos de varias filas a la vez
// (ej. getQuoteRequestDocumentData, attachProduct en supplierProduct.service.ts).
export async function getProductsByIds(ids: string[]): Promise<ProductDocument[]> {
  const validIds = ids.filter((id) => isValidObjectId(id));
  if (validIds.length === 0) return [];
  return ProductModel.find({ _id: { $in: validIds } });
}

// Batch por nombre EXACTO (name es unico): la carga masiva por CSV identifica el producto por su nombre. Los
// nombres llegan como strings (celdas de un CSV), asi que no pueden inyectar operadores de Mongo.
export async function getProductsByNames(names: string[]): Promise<ProductDocument[]> {
  const unique = [...new Set(names.filter((name) => typeof name === "string" && name.length > 0))];
  if (unique.length === 0) return [];
  return ProductModel.find({ name: { $in: unique } });
}

export async function createProduct(data: ProductCreationAttributes): Promise<ProductDocument> {
  if (data.categoryId) await getProductCategoryByIdOrThrow(data.categoryId);
  return ProductModel.create(data);
}

export async function updateProduct(id: string, data: ProductUpdateAttributes): Promise<ProductDocument> {
  const product = await getProductByIdOrThrow(id);
  if (data.categoryId) await getProductCategoryByIdOrThrow(data.categoryId);
  product.set(data);
  await product.save();
  return product;
}

// El propio _id del producto es el nombre de archivo (ver
// getProductImagesFolder en documentStorage.ts: carpeta plana compartida,
// no hace falta una subcarpeta por producto porque el nombre ya es unico).
// Una imagen por producto: una re-subida pisa la anterior, borrando el
// archivo viejo si la extension cambio (ej. re-subir en .png habiendo
// estado en .jpg) para no dejarlo huerfano en disco.
export async function attachProductImage(id: string, file: Express.Multer.File): Promise<string> {
  const product = await getProductByIdOrThrow(id);

  const extension = getSafeExtension(file);
  const filename = `${id}${extension}`;
  const folder = getProductImagesFolder();

  if (product.image) {
    const previousFilename = path.basename(product.image);
    if (previousFilename !== filename) deleteIfExists(folder, previousFilename);
  }

  saveBuffer(folder, filename, file.buffer);
  product.image = `uploads/images/products/${filename}`;
  await product.save();
  return filename;
}

export async function deactivateProduct(id: string): Promise<void> {
  const product = await getProductByIdOrThrow(id);
  product.isActive = false;
  await product.save();
}

function isMongoDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: number }).code === 11000;
}

// Catalogo de ejemplo para poder ejercitar el flujo de compras de punta a
// punta (Solicitud -> ... -> Activo): un producto por cada productType, para
// probar los 3 prefijos de tag de activo (ARR/SRV/ACT, ver
// services/postgres/asset.service.ts).
export async function seedProducts(): Promise<void> {
  const existing = await ProductModel.countDocuments();
  if (existing > 0) return;

  try {
    await ProductModel.create([
      {
        name: "Notebook Dell Latitude 5440",
        description: "Notebook corporativo 14 pulgadas, 16GB RAM, 512GB SSD",
        productType: "COMPRA",
      },
      {
        name: "Impresora multifuncional en arriendo",
        description: "Arriendo mensual de impresora multifuncional laser",
        productType: "ARRIENDO",
      },
      {
        name: "Soporte tecnico anual de servidores",
        description: "Servicio de mantencion y soporte tecnico anual",
        productType: "SERVICIO",
      },
    ]);
    logger.info("Seed de products (Mongo) aplicado");
  } catch (err) {
    if (!isMongoDuplicateKeyError(err)) throw err;
    logger.debug("Seed de products ya aplicado por otra replica, se omite");
  }
}
