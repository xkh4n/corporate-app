import { CreationOptional, DataTypes, InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { postgres } from "../../databases/postgres/connection";

// Catalogo jerarquico del menu de navegacion (self-referencing via
// parentId): un nodo "carpeta" (permissionId null) agrupa hijos, un nodo
// "hoja" referencia el permiso que lo habilita. Ver
// services/postgres/menuItem.service.ts (getMenuTreeForRole) para como se
// arma el arbol final a partir de esta tabla plana.
export class MenuItemModel extends Model<InferAttributes<MenuItemModel>, InferCreationAttributes<MenuItemModel>> {
  declare id: CreationOptional<number>;
  declare label: string;
  declare icon: string | null;
  declare link: string | null;
  declare parentId: number | null;
  declare permissionId: number | null;
  declare sortOrder: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

MenuItemModel.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    label: { type: DataTypes.STRING(100), allowNull: false },
    icon: { type: DataTypes.STRING(50), allowNull: true },
    link: { type: DataTypes.STRING(255), allowNull: true },
    parentId: { type: DataTypes.INTEGER, allowNull: true, field: "parent_id" },
    permissionId: { type: DataTypes.INTEGER, allowNull: true, field: "permission_id" },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: "sort_order" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: "is_active" },
    createdAt: { type: DataTypes.DATE, field: "created_at" },
    updatedAt: { type: DataTypes.DATE, field: "updated_at" },
  },
  {
    sequelize: postgres,
    tableName: "menu_items",
    timestamps: true,
  },
);
