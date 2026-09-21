import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { mssql } from "../../databases/mssql/connection";

// Vinculo N:M entre PurchaseOrder y Quote: una OC cubre VARIAS cotizaciones
// ganadoras -todas de la misma solicitud y del mismo proveedor (validado en
// purchaseOrder.service.ts; una OC nunca puede cruzar dos proveedores)-. El
// UNIQUE real vive en la BD sobre quote_id (uq_purchase_order_quotes_quote,
// ver migrate.ts): es lo unico race-safe con 3 replicas, un findOne() previo
// en la capa de servicio no lo es. Asociaciones (belongsToMany en ambos
// sentidos) viven en purchaseOrder.model.ts, no aca.
export class PurchaseOrderQuoteModel extends Model<
  InferAttributes<PurchaseOrderQuoteModel>,
  InferCreationAttributes<PurchaseOrderQuoteModel>
> {
  declare id: CreationOptional<number>;
  declare purchaseOrderId: number;
  declare quoteId: number;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

PurchaseOrderQuoteModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    purchaseOrderId: { type: DataTypes.INTEGER, allowNull: false, field: "purchase_order_id" },
    quoteId: { type: DataTypes.INTEGER, allowNull: false, field: "quote_id" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: mssql,
    tableName: "purchase_order_quotes",
    timestamps: true,
  },
);
