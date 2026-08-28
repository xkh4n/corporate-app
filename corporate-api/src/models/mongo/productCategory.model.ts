import mongoose, { Schema, model, Document, Model } from "mongoose";
import { idJsonTransform } from "../../library/mongoSchema";

// Lista abierta (el usuario dio ejemplos y dijo "etc") -coleccion lookup, no
// un enum hardcodeado, para poder agregar categorias nuevas via API sin
// redeploy. Mismo motivo que supplier_service_types/supplier_delivery_terms
// en MSSQL, pero en Mongo porque Product vive aca.
export interface ProductCategoryDocument extends Document {
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const productCategorySchema = new Schema<ProductCategoryDocument>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: null },
  },
  { timestamps: true, collection: "product_categories", toJSON: idJsonTransform },
);

// Guard contra OverwriteModelError bajo Vitest -ver el comentario en
// product.model.ts.
export const ProductCategoryModel =
  (mongoose.models.ProductCategory as Model<ProductCategoryDocument> | undefined) ??
  model<ProductCategoryDocument>("ProductCategory", productCategorySchema);
