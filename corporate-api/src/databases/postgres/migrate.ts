import { postgres } from "./connection";
import { logger } from "../../library/logger";
import { isDuplicateObjectError, isUniqueConstraintError } from "../../library/errors";

// Mismo problema que runDdl() en databases/mssql/migrate.ts, version
// Postgres: con las 3 replicas migrando en paralelo contra una base recien
// creada (instalacion limpia), "CREATE TABLE/INDEX IF NOT EXISTS" no es
// atomico frente al chequeo de existencia -Postgres documenta esta carrera-,
// asi que dos replicas pueden pasarlo a la vez. Segun el objeto, la carrera
// se resuelve como 42710/42P07 (isDuplicateObjectError, ya cubierto por las
// constraints con nombre explicito de abajo) o como un unique_violation real
// sobre el catalogo (pg_class.relname/relnamespace) que Sequelize normaliza
// a SequelizeUniqueConstraintError -encontrado en un clean install real de
// Testing (2026-08-18): "roles" nunca habia migrado antes en ese ambiente, y
// el CREATE TABLE IF NOT EXISTS sin guard tumbo el bootstrap de las 3
// replicas. Ninguno de los dos es un error real, es "otra replica ya dejo el
// objeto en el estado correcto".
async function runDdl(sql: string): Promise<void> {
  try {
    await postgres.query(sql);
  } catch (err) {
    if (!isDuplicateObjectError(err) && !isUniqueConstraintError(err)) throw err;
  }
}

// Migracion propia de la app (esquema de negocio), separada del bootstrap de
// infra (corporate-infra/PostgreSQL/init/*.sh, que solo crea roles/usuarios
// de conexion). Idempotente: CREATE TABLE IF NOT EXISTS + seed con
// ON CONFLICT DO NOTHING, seguro de correr en cada arranque del contenedor.
export async function migratePostgres(): Promise<void> {
  await migrateRoles();
  await migratePermissions();
  await migrateMenuItems();
  await migrateAssets();
  await migrateAssetTagCounters();
  await migrateAssetKardex();

  logger.info("Migracion de Postgres aplicada");
}

async function migrateRoles(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name VARCHAR(50) NOT NULL UNIQUE,
      description VARCHAR(255),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await postgres.query(`
    INSERT INTO roles (name, description) VALUES
      ('admin', 'Acceso total al sistema'),
      ('user', 'Acceso estandar')
    ON CONFLICT (name) DO NOTHING;
  `);
}

// Catalogo de permisos (resource+action) y su asignacion N:M a roles -
// reemplaza el chequeo binario "roleName === 'admin'" por una matriz
// configurable: cada ruta exige un permiso puntual (ver
// middlewares/authorize.ts), y el catalogo/las asignaciones por defecto se
// siembran en seed.ts (seedPermissions). "admin" sigue teniendo bypass total
// hardcodeado en el middleware (superusuario, no depende de filas en esta
// tabla), asi que nunca puede quedar bloqueado por un seed incompleto.
async function migratePermissions(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS permissions (
      id SERIAL PRIMARY KEY,
      resource VARCHAR(50) NOT NULL,
      action VARCHAR(20) NOT NULL,
      description VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (resource, action)
    );
  `);

  // Constraint con nombre explicito (en vez de dejar que Postgres le ponga
  // el default "permissions_action_check") para poder ensancharla de forma
  // idempotente cada vez que se agrega una accion nueva al enum
  // (PermissionAction en permission.model.ts) -"CREATE TABLE IF NOT EXISTS"
  // no la toca si la tabla ya existia de una corrida anterior con la lista
  // vieja, por eso el DROP+ADD explicito en cada arranque.
  // "permissions_action_check" es el nombre que Postgres le puso solo al
  // CHECK inline de la version anterior de esta migracion (sin nombre
  // explicito) -hay que tumbarlo tambien, si no queda enforceando la lista
  // vieja en paralelo con la nueva constraint de abajo.
  await runDdl(`ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_action_check;`);
  await runDdl(`ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_action_allowed;`);
  // Carrera entre las 3 replicas (DROP+ADD sin transaccion compartida): otra
  // replica ya la agrego entre nuestro DROP y nuestro ADD -runDdl() se traga
  // ese choque especifico.
  await runDdl(`
    ALTER TABLE permissions ADD CONSTRAINT permissions_action_allowed
      CHECK (action IN ('create','read','update','delete','approve'));
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    );
  `);
}

// Catalogo jerarquico del menu de navegacion (self-referencing via
// parent_id): un nodo "carpeta" (sin permission_id) agrupa hijos y no
// necesita permiso propio -su visibilidad se deriva de tener al menos un
// hijo alcanzable-, un nodo "hoja" referencia el permiso (resource+action,
// mismo catalogo que role_permissions) que lo habilita. Arma el arbol
// getMenuTreeForRole() en services/postgres/menuItem.service.ts, consumido
// por GET /auth/menu. is_active: soft-delete, mismo criterio que roles.
async function migrateMenuItems(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      label VARCHAR(100) NOT NULL,
      icon VARCHAR(50),
      link VARCHAR(255),
      parent_id INTEGER REFERENCES menu_items(id),
      permission_id INTEGER REFERENCES permissions(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_menu_items_parent_id ON menu_items(parent_id);
  `);

  // Postgres no tiene "ADD CONSTRAINT IF NOT EXISTS": intentar agregarla y
  // tragarse el choque (via runDdl) si otra replica ya la dejo en el estado
  // correcto -mismo criterio que permissions_action_allowed arriba, pero sin
  // el DROP previo (esta constraint no necesita "ensancharse" con el tiempo
  // como el CHECK de action). label es la clave estable del catalogo
  // (seedMenuItems, menu-catalog.ts): sin este UNIQUE, el upsert por label no
  // tiene sobre que hacer ON CONFLICT.
  await runDdl(`ALTER TABLE menu_items ADD CONSTRAINT uq_menu_items_label UNIQUE (label);`);
}

// cost_centers y asset_statuses son catalogos/lookup, igual criterio que
// roles. assets/asset_movements viven en Postgres por decision explicita del
// usuario (tag interno + relacion N:M con usuarios no encajaba junto a
// "users" en MSSQL, ver memoria project-erp-scope-and-data-classification).
// created_by/updated_by y user_id en asset_movement_users son referencias
// cross-engine hacia users (MSSQL) sin FK real -no hay motor que pueda
// validar esa integridad referencial a nivel de base de datos-, se validan
// a mano en la capa de servicio (mismo patron ya aceptado que users.role_id
// hacia roles, en la direccion inversa).
async function migrateAssets(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS cost_centers (
      id SERIAL PRIMARY KEY,
      code INTEGER NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      description VARCHAR(255),
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_statuses (
      id SERIAL PRIMARY KEY,
      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255),
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Lista abierta ("etc." segun el usuario): por eso es tabla lookup y no un
  // ENUM/CHECK hardcodeado -se pueden agregar estados nuevos sin migracion.
  await postgres.query(`
    INSERT INTO asset_statuses (code, name, description) VALUES
      ('RECEIVED', 'Ingresado', 'El activo ingreso a bodega tras su recepcion'),
      ('ASSIGNED', 'Asignado', 'El activo esta asignado a uno o mas usuarios'),
      ('AVAILABLE', 'Disponible', 'El activo esta disponible para asignar'),
      ('SUPPORT', 'En soporte', 'El activo esta en proceso de soporte/reparacion'),
      ('DECOMMISSIONED', 'De baja', 'El activo fue dado de baja')
    ON CONFLICT (code) DO NOTHING;
  `);

  // Modelo maestro + movimientos: el estado actual vive en assets.status_id,
  // no se recalcula buscando el ultimo movimiento.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY,
      tag VARCHAR(50) NOT NULL UNIQUE,
      status_id INTEGER NOT NULL REFERENCES asset_statuses(id),
      serial_number VARCHAR(100),
      warranty_expires_at DATE,
      value DECIMAL(18,2),
      received_at DATE,
      goods_receipt_id INTEGER,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // A diferencia de MSSQL (sin ALTER TABLE, ver migrate.ts de ese motor),
  // Postgres si soporta agregar una columna a una tabla ya existente de
  // forma idempotente -no hace falta el patron drop-and-recreate. Nullable:
  // los assets creados antes de este cambio quedan sin centro de costo,
  // no hay backfill.
  await runDdl(`
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS cost_center_id INTEGER REFERENCES cost_centers(id);
  `);

  // ObjectId de Mongo (coleccion products) en formato string -cross-engine,
  // sin FK real, mismo patron que employees.position_id. Nullable, sin
  // backfill: los assets creados antes de este cambio quedan sin producto
  // asociado. Hace falta para agregar el Kardex "por producto" (ver
  // migrateAssetKardex mas abajo) sin tener que saltar
  // Asset -> GoodsReceipt (MSSQL) -> PurchaseOrder -> Quote -> productId cada
  // vez que se necesita saber de que producto es un activo.
  await runDdl(`
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS product_id VARCHAR(24);
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_movements (
      id SERIAL PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      movement_type VARCHAR(20) NOT NULL CHECK (movement_type IN ('ASSIGNED','REASSIGNED','SUPPORT','DECOMMISSIONED')),
      movement_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      notes VARCHAR(255),
      created_by INTEGER,
      updated_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Un movimiento puede involucrar 1 o mas usuarios (N:M) -razon explicita
  // del usuario para sacar Asignacion de MSSQL, no encajaba junto a "users"
  // con un simple user_id 1:1.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_movement_users (
      id SERIAL PRIMARY KEY,
      asset_movement_id INTEGER NOT NULL REFERENCES asset_movements(id),
      user_id INTEGER NOT NULL,
      UNIQUE (asset_movement_id, user_id)
    );
  `);

  // asset_movements.asset_id: FK sin indice propio, filtrada directo en
  // listMovementsByAsset. asset_movement_users NO necesita uno equivalente:
  // el UNIQUE(asset_movement_id, user_id) de arriba ya es, en si mismo, un
  // indice compuesto con asset_movement_id como columna líder.
  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_asset_movements_asset_id ON asset_movements(asset_id);
  `);

  // Campos del acta de entrega (Fase E, formulario enriquecido): todos
  // nullable, sin backfill -las asignaciones ya existentes no tenian estos
  // datos. supervisorName es texto libre (no hay tabla de "jefe directo" en
  // el modelo de empleados hoy): se tipea al momento de asignar, no se deriva.
  await runDdl(`
    ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS supervisor_name VARCHAR(150);
  `);
  await runDdl(`
    ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS mac_address VARCHAR(17);
  `);
  // "accessories" (texto libre unico) se reemplazo por columnas discretas
  // -decision revisada del usuario: bolso/candado/cargador/almacenamiento/
  // memoria son atributos propios del acta, no un texto compuesto. DROP en vez
  // de dejarla huerfana: se agrego en esta misma fase, sin datos reales que
  // preservar salvo pruebas puntuales.
  await runDdl(`ALTER TABLE asset_movements DROP COLUMN IF EXISTS accessories;`);
  await runDdl(`ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS storage_capacity VARCHAR(20);`);
  await runDdl(`ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS ram_capacity VARCHAR(20);`);
  await runDdl(`ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS has_bag BOOLEAN;`);
  await runDdl(`ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS has_lock BOOLEAN;`);
  await runDdl(`ALTER TABLE asset_movements ADD COLUMN IF NOT EXISTS has_charger BOOLEAN;`);
}

// Contador atomico para el tag de activo (ARR/SRV/ACT segun
// Product.productType -ARRIENDO/SERVICIO/COMPRA-, ver
// services/postgres/asset.service.ts). Mismo patron que document_numbering
// en MSSQL (ver library/documentNumbering.ts), pero con "RETURNING" en vez
// de "OUTPUT" -sintaxis propia de Postgres para el mismo incremento atomico.
async function migrateAssetTagCounters(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_tag_counters (
      prefix VARCHAR(10) PRIMARY KEY,
      next_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  await postgres.query(`
    INSERT INTO asset_tag_counters (prefix, next_seq) VALUES
      ('ARR', 0),
      ('SRV', 0),
      ('ACT', 0)
    ON CONFLICT (prefix) DO NOTHING;
  `);
}

// Libro contable de valorizacion de activos (Kardex): insert-only, un
// renglon por movimiento -en vez de un documento por producto que se
// SOBRESCRIBE en cada recepcion (que perderia el historial salvo el ultimo
// movimiento), aca cada asiento queda escrito para siempre. Un error se
// corrige con un asiento ADJUSTMENT que lo compense,
// nunca editando/borrando el renglon anterior. product_id no lleva FK real
// (referencia cross-engine hacia Mongo, mismo criterio que assets.product_id
// de arriba) y se duplica desde assets.product_id al momento de insertar
// para poder agregar "por producto" (GET /asset-kardex/by-product) con un
// simple GROUP BY sobre esta misma tabla, sin tener que resolver cada activo
// contra Mongo en cada lectura.
async function migrateAssetKardex(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_kardex_entries (
      id SERIAL PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      product_id VARCHAR(24),
      entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('ACQUISITION','ADJUSTMENT','WRITE_OFF')),
      entry_date TIMESTAMPTZ NOT NULL DEFAULT now(),
      unit_cost DECIMAL(18,2) NOT NULL,
      amount DECIMAL(18,2) NOT NULL,
      balance DECIMAL(18,2) NOT NULL,
      reference VARCHAR(50),
      notes VARCHAR(255),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_asset_kardex_entries_asset_id_entry_date
      ON asset_kardex_entries(asset_id, entry_date);
  `);
  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_asset_kardex_entries_product_id ON asset_kardex_entries(product_id);
  `);
}
