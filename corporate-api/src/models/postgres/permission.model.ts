import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";

// "activate": habilitar algo que estaba desactivado (hoy solo roles:activate),
// separado de "update" para poder otorgarlo a usuarios puntuales.
// "access": permiso de pantalla (agrupador), incluye los permisos base que su
// vista necesita -ver PermissionIncludeModel y plan 006.
export type PermissionAction = "create" | "read" | "update" | "delete" | "approve" | "activate" | "access" | "all_view";

// Catalogo de permisos (resource+action): la base se siembra desde
// databases/permission-catalog.ts y se pueden sumar mas en caliente via
// POST /permissions; se asignan/desasignan a roles via RolePermissionModel.
export class PermissionModel extends Model<
  InferAttributes<PermissionModel>,
  InferCreationAttributes<PermissionModel>
> {
  declare id: CreationOptional<number>;
  declare resource: string;
  declare action: PermissionAction;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
}

PermissionModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    resource: { type: DataTypes.STRING(50), allowNull: false },
    action: { type: DataTypes.STRING(20), allowNull: false },
    description: { type: DataTypes.STRING(255), allowNull: true },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: postgres,
    tableName: "permissions",
    timestamps: false,
  },
);
