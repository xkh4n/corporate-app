import { isValidObjectId } from "mongoose";
import { ProductModel, ProductDocument } from "../../models/mongo/product.model";
import { NotFoundError } from "../../library/errors";
import { logger } from "../../library/logger";
import type { ProductCreationAttributes, ProductUpdateAttributes } from "../../types/mongo/product.types";

export async function listProducts(): Promise<ProductDocument[]> {
  return ProductModel.find().sort({ name: 1 });
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

export async function createProduct(data: ProductCreationAttributes): Promise<ProductDocument> {
  return ProductModel.create(data);
}

export async function updateProduct(id: string, data: ProductUpdateAttributes): Promise<ProductDocument> {
  const product = await getProductByIdOrThrow(id);
  product.set(data);
  await product.save();
  return product;
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
        productType: "PURCHASE",
      },
      {
        name: "Impresora multifuncional en arriendo",
        description: "Arriendo mensual de impresora multifuncional laser",
        productType: "LEASE",
      },
      {
        name: "Soporte tecnico anual de servidores",
        description: "Servicio de mantencion y soporte tecnico anual",
        productType: "SERVICE",
      },
    ]);
    logger.info("Seed de products (Mongo) aplicado");
  } catch (err) {
    if (!isMongoDuplicateKeyError(err)) throw err;
    logger.debug("Seed de products ya aplicado por otra replica, se omite");
  }
}
