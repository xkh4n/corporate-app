import { Schema, model, Document } from "mongoose";
import type { ProductType } from "../../types/mongo/product.types";
import { idJsonTransform } from "../../library/mongoSchema";

// Catalogo de producto/inventario: vive en Mongo por decision explicita del
// usuario (datos menos sensibles/no siempre estructurados, ver memoria
// project-erp-scope-and-data-classification). Referenciado desde MSSQL
// (PurchaseRequestLine/Quote/Authorization/GoodsReceipt.productId) por su
// _id en formato string, sin FK real -validado a mano en la capa de servicio.
export interface ProductDocument extends Document {
  name: string;
  description: string | null;
  // Determina el prefijo del tag del activo al recibir la mercaderia
  // (ARR/SRV/ACT), ver services/postgres/asset.service.ts.
  productType: ProductType;
  // Referencia a product_categories._id -opcional a proposito: los productos
  // sembrados antes de que existiera este campo no tienen categoria, y no se
  // fuerza un backfill. Sin FK real (misma coleccion, pero Mongoose no valida
  // referencias) -si se necesita, validar contra productCategory.service.ts.
  categoryId: string | null;
  // Path relativo servido por GET /products/:id/image (ej.
  // "uploads/images/products/<id>.jpg") -null hasta la primera subida via
  // POST /products/:id/image. Nunca se setea en el create/update generico,
  // solo desde attachProductImage (product.service.ts): el nombre de archivo
  // depende del propio _id, que recien existe despues de crear el producto.
  image: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<ProductDocument>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: null },
    productType: { type: String, required: true, enum: ["ARRIENDO", "SERVICIO", "COMPRA"] },
    categoryId: { type: Schema.Types.ObjectId, ref: "ProductCategory", default: null },
    image: { type: String, default: null },
    isActive: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, collection: "products", toJSON: idJsonTransform },
);

export const ProductModel = model<ProductDocument>("Product", productSchema);
