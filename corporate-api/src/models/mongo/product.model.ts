import { Schema, model, Document } from "mongoose";
import type { ProductType } from "../../types/mongo/product.types";

// Catalogo de producto/inventario: vive en Mongo por decision explicita del
// usuario (datos menos sensibles/no siempre estructurados, ver memoria
// project-erp-scope-and-data-classification). Referenciado desde MSSQL
// (PurchaseRequestLine/Quote/Authorization/GoodsReceipt.productId) por su
// _id en formato string, sin FK real -validado a mano en la capa de servicio.
export interface ProductDocument extends Document {
  name: string;
  description: string | null;
  // ARRIENDO/SERVICIO/COMPRA segun el usuario: determina el prefijo del tag
  // del activo al recibir la mercaderia (ARR/SRV/ACT), ver
  // services/postgres/asset.service.ts.
  productType: ProductType;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: null },
    productType: { type: String, required: true, enum: ["LEASE", "SERVICE", "PURCHASE"] },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, collection: "products" },
);

export const ProductModel = model<ProductDocument>("Product", productSchema);
