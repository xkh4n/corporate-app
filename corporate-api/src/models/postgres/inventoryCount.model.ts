import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import type { InventoryCountLineModel } from "./inventoryCountLine.model";

export type InventoryCountStatus = "OPEN" | "CLOSED";

// Cabecera de una toma de inventario fisica (levantamiento por un auditor).
// "Inicio de Inventario" la crea en OPEN; "Fin Inventario" la pasa a CLOSED y
// deja de aceptar lineas. number es el folio legible (IT-AAAA-NNNNNN), ver
// generateInventoryCountNumber en inventoryCount.service.ts.
export class InventoryCountModel extends Model<
  InferAttributes<InventoryCountModel>,
  InferCreationAttributes<InventoryCountModel>
> {
  declare id: CreationOptional<number>;
  declare number: string;
  declare name: string;
  declare notes: string | null;
  declare status: InventoryCountStatus;
  declare startedAt: Date;
  declare closedAt: Date | null;
  declare createdBy: number | null;
  declare closedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  // NonAttribute: solo esta poblado con include explicito, mismo patron que
  // AssetModel.status.
  declare lines?: NonAttribute<InventoryCountLineModel[]>;
}

InventoryCountModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    number: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    notes: { type: DataTypes.STRING(500), allowNull: true },
    status: { type: DataTypes.STRING(10), allowNull: false },
    // allowNull:false sin valor por defecto del lado cliente: el DEFAULT now()
    // de la columna no se activa si Sequelize rechaza antes el insert, por
    // eso el servicio pasa startedAt explicito.
    startedAt: { type: DataTypes.DATE, allowNull: false, field: "started_at" },
    closedAt: { type: DataTypes.DATE, allowNull: true, field: "closed_at" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    closedBy: { type: DataTypes.INTEGER, allowNull: true, field: "closed_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "inventory_counts",
    timestamps: true,
  },
);
