import { postgres } from "./connection";
import { logger } from "../../library/logger";

// Migracion propia de la app (esquema de negocio), separada del bootstrap de
// infra (corporate-infra/PostgreSQL/init/*.sh, que solo crea roles/usuarios
// de conexion). Idempotente: CREATE TABLE IF NOT EXISTS + seed con
// ON CONFLICT DO NOTHING, seguro de correr en cada arranque del contenedor.
export async function migratePostgres(): Promise<void> {
  await migrateRoles();
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
// Product.productType -LEASE/SERVICE/PURCHASE-, ver
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
