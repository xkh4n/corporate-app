import { postgres } from "./connection";
import { logger } from "../../library/logger";
import { isDuplicateObjectError } from "../../library/errors";

// Migracion propia de la app (esquema de negocio), separada del bootstrap de
// infra (corporate-infra/PostgreSQL/init/*.sh, que solo crea roles/usuarios
// de conexion). Idempotente: CREATE TABLE IF NOT EXISTS + seed con
// ON CONFLICT DO NOTHING, seguro de correr en cada arranque del contenedor.
export async function migratePostgres(): Promise<void> {
  await migrateRoles();
  await migratePermissions();
  await migrateAssets();
  await migrateAssetTagCounters();

  logger.info("Migracion de Postgres aplicada");
}

async function migrateRoles(): Promise<void> {
  await postgres.query(`
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
  await postgres.query(`
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
  await postgres.query(`ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_action_check;`);
  await postgres.query(`ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_action_allowed;`);
  try {
    await postgres.query(`
      ALTER TABLE permissions ADD CONSTRAINT permissions_action_allowed
        CHECK (action IN ('create','read','update','delete','approve'));
    `);
  } catch (err) {
    // Carrera entre las 3 replicas (DROP+ADD sin transaccion compartida):
    // otra replica ya la agrego entre nuestro DROP y nuestro ADD. Mismo
    // criterio que isUniqueConstraintError para los seeds de datos.
    if (!isDuplicateObjectError(err)) throw err;
  }

  await postgres.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    );
  `);
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
  await postgres.query(`
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

  await postgres.query(`
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
  await postgres.query(`
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
  await postgres.query(`
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS cost_center_id INTEGER REFERENCES cost_centers(id);
  `);

  await postgres.query(`
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
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS asset_movement_users (
      id SERIAL PRIMARY KEY,
      asset_movement_id INTEGER NOT NULL REFERENCES asset_movements(id),
      user_id INTEGER NOT NULL,
      UNIQUE (asset_movement_id, user_id)
    );
  `);
}

// Contador atomico para el tag de activo (ARR/SRV/ACT segun
// Product.productType -ARRIENDO/SERVICIO/COMPRA-, ver
// services/postgres/asset.service.ts). Mismo patron que document_numbering
// en MSSQL (ver library/documentNumbering.ts), pero con "RETURNING" en vez
// de "OUTPUT" -sintaxis propia de Postgres para el mismo incremento atomico.
async function migrateAssetTagCounters(): Promise<void> {
  await postgres.query(`
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
