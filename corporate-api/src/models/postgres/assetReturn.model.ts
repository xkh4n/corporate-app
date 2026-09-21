import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { CostCenterModel } from "./costCenter.model";
import type { AssetReturnLineModel } from "./assetReturnLine.model";

export type AssetReturnStatus = "DRAFT" | "SENT" | "RECEIVED" | "CANCELLED";

// OWN: equipos asignados al propio solicitante (el centro de costo lo define el activo y no se elige).
// OTHERS: equipos asignados a otro usuario (el solicitante elige el centro de costo). No se mezclan.
export type AssetReturnScope = "OWN" | "OTHERS";

// Devolucion de uno o mas activos de UN centro de costo hacia Adquisiciones TI,
// respaldada por una guia de despacho en PDF. code (DEV<centro><aaaammddHHmmssSSS>)
// es a la vez el nombre del archivo y se asigna al adjuntar la guia por primera
// vez, por eso es null en un borrador sin guia. Ver library/assetReturnCode.ts.
export class AssetReturnModel extends Model<InferAttributes<AssetReturnModel>, InferCreationAttributes<AssetReturnModel>> {
  declare id: CreationOptional<number>;
  declare code: string | null;
  declare costCenterId: number;
  declare holderScope: AssetReturnScope;
  declare status: AssetReturnStatus;
  declare documentFilename: string | null;
  declare notes: string | null;
  declare requestedBy: number | null;
  declare sentAt: Date | null;
  declare sentBy: number | null;
  declare receivedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  declare costCenter?: NonAttribute<CostCenterModel>;
  declare lines?: NonAttribute<AssetReturnLineModel[]>;
}

AssetReturnModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(40), allowNull: true, unique: true },
    costCenterId: { type: DataTypes.INTEGER, allowNull: false, field: "cost_center_id" },
    // Sin valor por defecto del lado cliente: el servicio lo pasa siempre.
    holderScope: { type: DataTypes.STRING(6), allowNull: false, field: "holder_scope" },
    // Sin valor por defecto del lado cliente: el DEFAULT de la columna no se
    // activa si Sequelize rechaza antes el insert, el servicio pasa "DRAFT".
    status: { type: DataTypes.STRING(10), allowNull: false },
    documentFilename: { type: DataTypes.STRING(80), allowNull: true, field: "document_filename" },
    notes: { type: DataTypes.STRING(500), allowNull: true },
    requestedBy: { type: DataTypes.INTEGER, allowNull: true, field: "requested_by" },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: "sent_at" },
    sentBy: { type: DataTypes.INTEGER, allowNull: true, field: "sent_by" },
    receivedAt: { type: DataTypes.DATE, allowNull: true, field: "received_at" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "asset_returns",
    timestamps: true,
  },
);

AssetReturnModel.belongsTo(CostCenterModel, { foreignKey: "costCenterId", as: "costCenter" });
