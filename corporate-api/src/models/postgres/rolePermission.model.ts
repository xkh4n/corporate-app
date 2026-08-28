import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { RoleModel } from "./role.model";
import { PermissionModel } from "./permission.model";

// Tabla intermedia N:M entre roles y permissions -mismo patron que
// asset_movement_users. PK compuesta (role_id, permission_id): no hace falta
// un id propio, la combinacion ya es unica.
export class RolePermissionModel extends Model<
  InferAttributes<RolePermissionModel>,
  InferCreationAttributes<RolePermissionModel>
> {
  declare roleId: number;
  declare permissionId: number;
  declare createdAt: CreationOptional<Date>;
}

RolePermissionModel.init(
  {
    roleId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, field: "role_id" },
    permissionId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, field: "permission_id" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: postgres,
    tableName: "role_permissions",
    timestamps: false,
  },
);

RolePermissionModel.belongsTo(RoleModel, { foreignKey: "roleId", as: "role" });
RolePermissionModel.belongsTo(PermissionModel, { foreignKey: "permissionId", as: "permission" });
RoleModel.hasMany(RolePermissionModel, { foreignKey: "roleId", as: "rolePermissions" });
PermissionModel.hasMany(RolePermissionModel, { foreignKey: "permissionId", as: "rolePermissions" });
RoleModel.belongsToMany(PermissionModel, {
  through: RolePermissionModel,
  foreignKey: "roleId",
  otherKey: "permissionId",
  as: "permissions",
});
PermissionModel.belongsToMany(RoleModel, {
  through: RolePermissionModel,
  foreignKey: "permissionId",
  otherKey: "roleId",
  as: "roles",
});
