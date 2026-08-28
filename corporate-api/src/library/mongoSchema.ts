import type { SchemaOptions } from "mongoose";

// Mongoose expone "_id"/"__v" en el JSON de salida por defecto, no "id"
// -a diferencia del resto de la API (Sequelize/MSSQL y Postgres ya usan
// "id" como PK nativa). Sin esto, cualquier tipo espejo del frontend que
// declare "id: string" para una entidad Mongo (Product, ProductCategory)
// lo recibe undefined -bug real encontrado en produccion: rompio la URL de
// imagen de producto (`/api/products/undefined/image`) y el <select> de
// categoria en CreateProducts.tsx (value={cat.id} siempre "undefined").
// "virtuals: true" habilita el virtual "id" (string de _id) que Mongoose ya
// define solo por default en cada schema -no hace falta declararlo a mano,
// solo pedirle a toJSON que lo incluya.
export const idJsonTransform: SchemaOptions["toJSON"] = {
  virtuals: true,
  transform: (_doc: unknown, ret: Record<string, unknown>) => {
    delete ret._id;
    delete ret.__v;
  },
};
