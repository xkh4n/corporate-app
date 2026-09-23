import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";
import { PermissionModel } from "./permission.model";

// Tabla intermedia N:M de permissions consigo misma (plan 006): un permiso de
// pantalla (action = "access") incluye los permisos base que su vista
// necesita. Asignarle el agrupador a un rol equivale a asignarle todo lo que
// incluye -la expansion la hace permission.service.ts (hasPermission,
// getEffectivePermissionsForRole, getRoleIdsWithPermission). Un solo nivel:
// solo un "access" incluye, y nunca a otro "access" (validado en el servicio).
export class PermissionIncludeModel extends Model<
  InferAttributes<PermissionIncludeModel>,
  InferCreationAttributes<PermissionIncludeModel>
> {
  declare permissionId: number;
  declare includedPermissionId: number;
  declare createdAt: CreationOptional<Date>;
}

PermissionIncludeModel.init(
  {
    permissionId: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, field: "permission_id" },
    includedPermissionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      field: "included_permission_id",
    },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
  },
  {
    sequelize: postgres,
    tableName: "permission_includes",
    timestamps: false,
  },
);

PermissionModel.belongsToMany(PermissionModel, {
  through: PermissionIncludeModel,
  foreignKey: "permissionId",
  otherKey: "includedPermissionId",
  as: "includedPermissions",
});
