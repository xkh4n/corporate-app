import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model, NonAttribute } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { AssetModel } from "./asset.model";
import type { AssetMovementUserModel } from "./assetMovementUser.model";

export type AssetMovementType = "ASSIGNED" | "REASSIGNED" | "SUPPORT" | "DECOMMISSIONED" | "RETURNED" | "DEVALUATED" | "MOVE_TO_RETURNED";

export class AssetMovementModel extends Model<
  InferAttributes<AssetMovementModel>,
  InferCreationAttributes<AssetMovementModel>
> {
  declare id: CreationOptional<number>;
  declare assetId: number;
  declare movementType: AssetMovementType;
  declare movementDate: CreationOptional<Date>;
  declare notes: string | null;
  // Campos del acta de entrega (Fase E enriquecida): todos opcionales, solo
  // tienen sentido en movementType ASSIGNED/REASSIGNED. supervisorName es
  // texto libre -no hay tabla de "jefe directo" en el modelo de empleados
  // (se tipea al asignar, no se deriva).
  // storageCapacity/ramCapacity/has* (Almacenamiento/Memoria RAM/bolso/
  // candado/cargador) -tampoco se derivan de ningun catalogo, son datos de la
  // UNIDAD puntual, se tipean cada vez que se asigna.
  declare supervisorName: string | null;
  declare macAddress: string | null;
  declare storageCapacity: string | null;
  declare ramCapacity: string | null;
  declare hasBag: boolean | null;
  declare hasLock: boolean | null;
  declare hasCharger: boolean | null;
  declare createdBy: number | null;
  declare updatedBy: number | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
  // NonAttribute: solo esta poblado cuando el query pide explicitamente
  // include:[{model: AssetMovementUserModel, as:"movementUsers"}] (ver
  // listMovementsByAsset/getAssetHandoverData en assetMovement.service.ts)
  // -no es una columna propia de "asset_movements". Mismo patron que
  // AssetModel.status.
  declare movementUsers?: NonAttribute<AssetMovementUserModel[]>;
}

AssetMovementModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assetId: { type: DataTypes.INTEGER, allowNull: false, field: "asset_id" },
    movementType: { type: DataTypes.STRING(20), allowNull: false, field: "movement_type" },
    movementDate: { type: DataTypes.DATE, allowNull: false, field: "movement_date" },
    notes: { type: DataTypes.STRING(255), allowNull: true },
    supervisorName: { type: DataTypes.STRING(150), allowNull: true, field: "supervisor_name" },
    macAddress: { type: DataTypes.STRING(17), allowNull: true, field: "mac_address" },
    storageCapacity: { type: DataTypes.STRING(20), allowNull: true, field: "storage_capacity" },
    ramCapacity: { type: DataTypes.STRING(20), allowNull: true, field: "ram_capacity" },
    hasBag: { type: DataTypes.BOOLEAN, allowNull: true, field: "has_bag" },
    hasLock: { type: DataTypes.BOOLEAN, allowNull: true, field: "has_lock" },
    hasCharger: { type: DataTypes.BOOLEAN, allowNull: true, field: "has_charger" },
    createdBy: { type: DataTypes.INTEGER, allowNull: true, field: "created_by" },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: "updated_by" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "asset_movements",
    timestamps: true,
  },
);

AssetMovementModel.belongsTo(AssetModel, { foreignKey: "assetId", as: "asset" });
AssetModel.hasMany(AssetMovementModel, { foreignKey: "assetId", as: "movements" });
