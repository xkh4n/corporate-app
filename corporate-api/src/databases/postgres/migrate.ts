import { QueryTypes } from "sequelize";
import { postgres } from "./connection";
import { env } from "../../library/env";
import { logger } from "../../library/logger";
import { isDuplicateObjectError, isUniqueConstraintError } from "../../library/errors";
import { DEFAULT_PRIORITY_MATRIX } from "../../library/serviceDesk/ticketRules";
import {
  DEFAULT_CALENDAR,
  DEFAULT_CATALOG_ITEMS,
  DEFAULT_CATEGORIES,
  DEFAULT_GROUPS,
  DEFAULT_HOLIDAYS,
  DEFAULT_SLA_POLICIES,
  EQUIPMENT_REQUEST_ITEM_NAME,
} from "../serviceDesk-defaults";

// Tiempos maximos de espera por un lock, en ms. Los ALTER TABLE piden un lock fuerte aunque el cambio sea un
// no-op (ADD COLUMN IF NOT EXISTS): con una consulta larga de otra replica en curso, esperar sin limite deja la
// tabla encolada y CONGELA todo el trafico que llega despues. Con limite el arranque falla rapido, el
// contenedor se reinicia (restart policy) y reintenta cuando la tabla esta libre.
const DDL_LOCK_TIMEOUT_MS = 30_000;
// Espera de una replica a que otra termine de migrar (ver migratePostgres).
const MIGRATION_LOCK_TIMEOUT_MS = 120_000;
const MIGRATION_LOCK_KEY = "corporate-api:migrate-postgres";

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
// runDdl() traga tambien el unique_violation: un CREATE UNIQUE INDEX sobre filas YA duplicadas falla
// con ese mismo error y "pasaba" sin crear el indice, dejando la garantia sin proteger en silencio.
// Tras crear un indice unico se verifica que exista de verdad.
async function assertIndexExists(indexName: string): Promise<void> {
  const rows = await postgres.query(`SELECT 1 FROM pg_indexes WHERE indexname = :indexName`, {
    replacements: { indexName },
    type: QueryTypes.SELECT,
  });
  if (rows.length === 0) {
    throw new Error(`No se pudo crear el indice ${indexName}: revise si ya existen filas que lo violan`);
  }
}

// "ADD COLUMN IF NOT EXISTS" y "CREATE INDEX IF NOT EXISTS" piden el lock de la tabla ANTES de comprobar que el
// objeto ya existe (ADD COLUMN: ACCESS EXCLUSIVE; CREATE INDEX: SHARE, que bloquea escrituras). En un reinicio en
// caliente, con otras replicas sirviendo trafico, cada arranque encolaba trafico por nada: se consulta el catalogo
// primero y solo se ejecuta el DDL si falta.
async function alreadyApplied(sql: string): Promise<boolean> {
  const column = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(sql);
  if (column) {
    const rows = await postgres.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
      { replacements: { table: column[1], column: column[2] }, type: QueryTypes.SELECT },
    );
    return rows.length > 0;
  }
  const index = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/i.exec(sql);
  if (index) {
    const rows = await postgres.query(`SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = :name`, {
      replacements: { name: index[1] },
      type: QueryTypes.SELECT,
    });
    return rows.length > 0;
  }
  return false;
}

async function runDdl(sql: string): Promise<void> {
  if (await alreadyApplied(sql)) return;
  try {
    // Cada DDL en su propia transaccion para acotar la espera de locks con SET LOCAL (solo vale dentro de ella:
    // no cambia la sesion de la conexion, que vuelve al pool). Ningun DDL de este archivo es CONCURRENTLY.
    await postgres.transaction(async (transaction) => {
      await postgres.query(`SET LOCAL lock_timeout = ${DDL_LOCK_TIMEOUT_MS}`, { transaction });
      await postgres.query(sql, { transaction });
    });
  } catch (err) {
    if (!isDuplicateObjectError(err) && !isUniqueConstraintError(err)) throw err;
  }
}

// Migracion propia de la app (esquema de negocio), separada del bootstrap de
// infra (corporate-infra/PostgreSQL/init/*.sh, que solo crea roles/usuarios
// de conexion). Idempotente: CREATE TABLE IF NOT EXISTS + seed con
// ON CONFLICT DO NOTHING, seguro de correr en cada arranque del contenedor.
//
// Las replicas se serializan con un advisory lock: solo una migra a la vez (antes las 3 corrian el mismo DDL en
// paralelo y la carrera se resolvia tragando errores de "ya existe", ver runDdl). El lock lo sostiene una
// transaccion que no hace nada mas; la migracion usa otras conexiones del pool (por eso exige max >= 2). Si la
// replica que migra se cuelga, las demas esperan MIGRATION_LOCK_TIMEOUT_MS y fallan (se reinician y reintentan).
export async function migratePostgres(): Promise<void> {
  if (env.pool.max < 2) {
    await applyPostgresMigrations();
    return;
  }
  await postgres.transaction(async (transaction) => {
    const startedAt = Date.now();
    await postgres.query(`SET LOCAL lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`, { transaction });
    await postgres.query(`SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))`, {
      replacements: { key: MIGRATION_LOCK_KEY },
      type: QueryTypes.SELECT,
      transaction,
    });
    logger.info({ waitedMs: Date.now() - startedAt }, "Migracion de Postgres: lock obtenido");
    await applyPostgresMigrations();
  });
}

async function applyPostgresMigrations(): Promise<void> {
  await migrateRoles();
  await migratePermissions();
  await migrateMenuItems();
  await migrateAssets();
  await migrateAssetTagCounters();
  await migrateAssetKardex();
  await migrateInventoryCounts();
  await migrateAssetReturns();
  await migrateAssetAccounting();
  await migrateAssetWriteOffs();
  await migrateServiceDesk();
  await migrateIntegrityAndIndexes();

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
      CHECK (action IN ('create','read','update','delete','approve','activate','access','all_view'));
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (role_id, permission_id)
    );
  `);

  // Permisos de pantalla (action = 'access', plan 006): un agrupador incluye
  // los permisos base que su pantalla necesita, y hasPermission() lo expande
  // (ver permission.service.ts). Un solo nivel -solo un 'access' incluye y
  // nunca a otro 'access'-: esa regla vive en el servicio, no en un CHECK,
  // porque depende de la fila referenciada.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS permission_includes (
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      included_permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (permission_id, included_permission_id),
      CHECK (permission_id <> included_permission_id)
    );
  `);
  // Para la expansion inversa ("¿que agrupadores incluyen X?"), que corre en
  // cada request via hasPermission().
  await runDdl(`
    CREATE INDEX IF NOT EXISTS idx_permission_includes_included
      ON permission_includes (included_permission_id);
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
      ('DECOMMISSIONED', 'De baja', 'El activo fue dado de baja'),
      ('DAMAGED', 'Dañado', 'El activo esta danado y no operativo (levantado en una toma de inventario)'),
      ('RETURNED', 'Devolución', 'El activo fue devuelto por su usuario y esta pendiente de revision por Soporte TI / Adquisiciones TI'),
      ('DEVALUATED', 'Devaluado', 'Activo dado de baja que se encontro en uso: sigue asignado con valor 0, sin afectar el kardex'),
      ('MOVE_TO_RETURNED', 'En tránsito a devolución', 'El activo fue despachado con guia hacia Adquisiciones TI y aun no ha sido recibido'),
      ('WRITTEN_OFF', 'De baja', 'Baja contable confirmada: definitiva')
    ON CONFLICT (code) DO NOTHING;
  `);
  // Plan 013: DECOMMISSIONED es la baja operativa, pendiente de la baja contable (que la deja WRITTEN_OFF).
  // La siembra no pisa nombres existentes (ON CONFLICT DO NOTHING): el cambio va explicito.
  await postgres.query(`
    UPDATE asset_statuses
       SET name = 'Pendiente de baja contable',
           description = 'Dado de baja operativamente (Kardex en cero); pendiente de la baja contable'
     WHERE code = 'DECOMMISSIONED' AND name <> 'Pendiente de baja contable';
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

  // El CHECK inline de arriba (nombre automatico asset_movements_movement_type_check)
  // solo conocia 4 tipos. RETURNED (devolucion), MOVE_TO_RETURNED (en transito
  // hacia Adquisiciones) y DEVALUATED (baja reactivada en una toma de
  // inventario) lo ensanchan: mismo patron DROP + ADD con nombre
  // explicito que permissions_action_allowed, para poder ensancharlo de nuevo.
  // Se reescribe SOLO si la definicion vigente no incluye todos los tipos (cada arranque de cada replica
  // hacia DROP + ADD y ese ALTER toma ACCESS EXCLUSIVE y revalida la tabla, que crece). El DROP y el ADD van
  // en UNA sentencia: no hay ventana sin CHECK entre ambos.
  // SUPPORT_TO_HOLDER / SUPPORT_TO_STOCK (plan 009): el activo vuelve de soporte a su tenedor o a bodega.
  const movementTypes = [
    'ASSIGNED',
    'REASSIGNED',
    'SUPPORT',
    'DECOMMISSIONED',
    'RETURNED',
    'DEVALUATED',
    'MOVE_TO_RETURNED',
    'SUPPORT_TO_HOLDER',
    'SUPPORT_TO_STOCK',
    // Plan 013: confirmacion de la baja contable (DECOMMISSIONED -> WRITTEN_OFF).
    'WRITTEN_OFF',
  ];
  const currentMovementCheck = await postgres.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'asset_movements'::regclass AND conname = 'asset_movements_movement_type_allowed'`,
    { type: QueryTypes.SELECT },
  );
  const movementCheckUpToDate =
    currentMovementCheck.length > 0 && movementTypes.every((type) => currentMovementCheck[0]!.definition.includes(`'${type}'`));
  if (!movementCheckUpToDate) {
    await runDdl(`
      ALTER TABLE asset_movements
        DROP CONSTRAINT IF EXISTS asset_movements_movement_type_check,
        DROP CONSTRAINT IF EXISTS asset_movements_movement_type_allowed,
        ADD CONSTRAINT asset_movements_movement_type_allowed
          CHECK (movement_type IN (${movementTypes.map((type) => `'${type}'`).join(',')}));
    `);
  }

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

// Gestion contable de activos (plan 007, ciclo ITIL): clasificacion contable,
// costo (adquisicion + atribuibles), capitalizacion y depreciacion con cierre
// mensual. El valor libro sigue siendo el saldo del Kardex: capitalizar
// escribe CAPITALIZATION (los atribuibles) y cada cierre escribe DEPRECIATION
// (negativo); anular el ultimo cierre escribe DEPRECIATION_REVERSAL. Nada se
// borra del Kardex (mismo criterio insert-only de migrateAssetKardex).
async function migrateAssetAccounting(): Promise<void> {
  // "DEPRECIATION_REVERSAL" tiene 21 caracteres: se amplia entry_type a 30.
  // Ampliar un VARCHAR no reescribe la tabla, pero igual pide un lock
  // exclusivo: se consulta primero para no tomarlo en cada arranque.
  const [entryType] = await postgres.query<{ length: number | null }>(
    `SELECT character_maximum_length AS length FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'asset_kardex_entries' AND column_name = 'entry_type'`,
    { type: QueryTypes.SELECT },
  );
  if (entryType?.length !== undefined && entryType.length !== null && entryType.length < 30) {
    await runDdl(`ALTER TABLE asset_kardex_entries ALTER COLUMN entry_type TYPE VARCHAR(30);`);
  }

  // CHECK con nombre explicito (antes inline, con el nombre que le puso
  // Postgres) para poder ensancharlo de forma idempotente -mismo patron que
  // permissions_action_allowed.
  await runDdl(`ALTER TABLE asset_kardex_entries DROP CONSTRAINT IF EXISTS asset_kardex_entries_entry_type_check;`);
  await runDdl(`ALTER TABLE asset_kardex_entries DROP CONSTRAINT IF EXISTS asset_kardex_entries_entry_type_allowed;`);
  await runDdl(`
    ALTER TABLE asset_kardex_entries ADD CONSTRAINT asset_kardex_entries_entry_type_allowed
      CHECK (entry_type IN ('ACQUISITION','ADJUSTMENT','WRITE_OFF','CAPITALIZATION','DEPRECIATION','DEPRECIATION_REVERSAL'));
  `);

  // Politica contable: clases de activo con sus valores por defecto (vida
  // util SII, metodo, tasa residual). No se borran: is_active.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_accounting_classes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(30) NOT NULL UNIQUE,
      name VARCHAR(100) NOT NULL,
      useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0 AND useful_life_months <= 1200),
      default_method VARCHAR(20) NOT NULL CHECK (default_method IN ('LINEAR','ACCELERATED')),
      residual_rate NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (residual_rate >= 0 AND residual_rate < 1),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Vida util normal segun la tabla del SII (en meses), editable despues
  // desde "Politica Contable de Activos". ON CONFLICT: no pisa lo editado.
  await postgres.query(`
    INSERT INTO asset_accounting_classes (code, name, useful_life_months, default_method) VALUES
      ('COMPUTER-EQUIPMENT', 'Equipos computacionales', 72, 'LINEAR'),
      ('FURNITURE', 'Muebles y enseres', 84, 'LINEAR'),
      ('VEHICLES', 'Vehiculos', 84, 'LINEAR'),
      ('MACHINERY', 'Maquinaria y equipos', 180, 'LINEAR')
    ON CONFLICT (code) DO NOTHING;
  `);

  // Una sola fila (id = 1): umbral minimo para capitalizar (bajo el, se
  // sugiere clasificar como gasto).
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_accounting_policy (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      capitalization_threshold NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (capitalization_threshold >= 0),
      updated_by INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await postgres.query(`INSERT INTO asset_accounting_policy (id) VALUES (1) ON CONFLICT (id) DO NOTHING;`);

  // 1:1 con assets. Sin fila = pendiente de clasificar. EXPENSE/INVENTORY
  // quedan en CLASSIFIED como estado final (no se capitalizan ni deprecian).
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_accounting (
      asset_id INTEGER PRIMARY KEY REFERENCES assets(id),
      classification VARCHAR(20) NOT NULL CHECK (classification IN ('FIXED_ASSET','EXPENSE','INVENTORY')),
      class_id INTEGER REFERENCES asset_accounting_classes(id),
      stage VARCHAR(20) NOT NULL
        CHECK (stage IN ('CLASSIFIED','COSTED','CAPITALIZED','DEPRECIATING','FULLY_DEPRECIATED')),
      acquisition_cost NUMERIC(18,2),
      capitalized_cost NUMERIC(18,2),
      useful_life_months INTEGER CHECK (useful_life_months > 0 AND useful_life_months <= 1200),
      depreciation_method VARCHAR(20) CHECK (depreciation_method IN ('LINEAR','ACCELERATED')),
      residual_value NUMERIC(18,2) CHECK (residual_value >= 0),
      depreciation_start_date DATE CHECK (EXTRACT(DAY FROM depreciation_start_date) = 1),
      classified_by INTEGER,
      classified_at TIMESTAMPTZ,
      costed_by INTEGER,
      costed_at TIMESTAMPTZ,
      capitalized_by INTEGER,
      capitalized_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (classification <> 'FIXED_ASSET' OR class_id IS NOT NULL)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_accounting_stage ON asset_accounting(stage);`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_attributable_costs (
      id SERIAL PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES asset_accounting(asset_id),
      concept VARCHAR(150) NOT NULL,
      amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
      document_ref VARCHAR(50),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_attributable_costs_asset_id ON asset_attributable_costs(asset_id);`);

  // Cierres mensuales. Un periodo puede tener cierres VOIDED (anulados) y a lo
  // mas UNO CLOSED: el indice unico parcial es el que impide un cierre doble
  // entre las 3 replicas aunque fallara el advisory lock del servicio.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_depreciation_runs (
      id SERIAL PRIMARY KEY,
      period DATE NOT NULL CHECK (EXTRACT(DAY FROM period) = 1),
      status VARCHAR(10) NOT NULL CHECK (status IN ('CLOSED','VOIDED')),
      asset_count INTEGER NOT NULL DEFAULT 0,
      total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      closed_by INTEGER,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      voided_by INTEGER,
      voided_at TIMESTAMPTZ
    );
  `);
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_depreciation_runs_closed_period
      ON asset_depreciation_runs(period) WHERE status = 'CLOSED';
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
      run_id INTEGER NOT NULL REFERENCES asset_depreciation_runs(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
      accumulated NUMERIC(18,2) NOT NULL,
      book_value NUMERIC(18,2) NOT NULL,
      PRIMARY KEY (run_id, asset_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_depreciation_entries_asset_id ON asset_depreciation_entries(asset_id);`);
}

// Baja contable (plan 008): cierra el ciclo contable de activos que ya estan
// dados de baja operativamente (DECOMMISSIONED, Kardex en cero). Se arma como
// borrador (fotos por activo + un certificado notarial) y al confirmar es
// definitiva: los activos pasan a la etapa WRITTEN_OFF.
async function migrateAssetWriteOffs(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_write_offs (
      id SERIAL PRIMARY KEY,
      status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED')),
      write_off_date DATE,
      reason VARCHAR(255),
      notary VARCHAR(120),
      certificate_number VARCHAR(60),
      certificate_filename VARCHAR(80),
      asset_count INTEGER NOT NULL DEFAULT 0,
      total_book_value NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_by INTEGER,
      confirmed_at TIMESTAMPTZ,
      CHECK (status <> 'CONFIRMED'
        OR (write_off_date IS NOT NULL AND reason IS NOT NULL AND certificate_filename IS NOT NULL
            AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_write_offs_status ON asset_write_offs(status);`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_write_off_lines (
      write_off_id INTEGER NOT NULL REFERENCES asset_write_offs(id) ON DELETE CASCADE,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      stage_before VARCHAR(20),
      book_value NUMERIC(18,2),
      PRIMARY KEY (write_off_id, asset_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_write_off_lines_asset_id ON asset_write_off_lines(asset_id);`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_write_off_photos (
      id SERIAL PRIMARY KEY,
      write_off_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      filename VARCHAR(80) NOT NULL,
      mime_type VARCHAR(30) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      created_by INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (write_off_id, asset_id)
        REFERENCES asset_write_off_lines(write_off_id, asset_id) ON DELETE CASCADE
    );
  `);
  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_asset_write_off_photos_line ON asset_write_off_photos(write_off_id, asset_id);
  `);

  // Etapa WRITTEN_OFF: el CHECK inline de stage (nombre puesto por Postgres)
  // pasa a uno con nombre, mismo patron que permissions_action_allowed.
  await runDdl(`ALTER TABLE asset_accounting DROP CONSTRAINT IF EXISTS asset_accounting_stage_check;`);
  await runDdl(`ALTER TABLE asset_accounting DROP CONSTRAINT IF EXISTS asset_accounting_stage_allowed;`);
  await runDdl(`
    ALTER TABLE asset_accounting ADD CONSTRAINT asset_accounting_stage_allowed
      CHECK (stage IN ('CLASSIFIED','COSTED','CAPITALIZED','DEPRECIATING','FULLY_DEPRECIATED','WRITTEN_OFF'));
  `);
  await runDdl(`
    ALTER TABLE asset_accounting ADD COLUMN IF NOT EXISTS write_off_id INTEGER REFERENCES asset_write_offs(id);
  `);

  // Plan 013: la foto se toma al dar de baja (Dar de Baja Activos) y queda con el activo; la baja
  // contable la reutiliza. movement_id: el movimiento DECOMMISSIONED que la acompania.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_decommission_photos (
      id SERIAL PRIMARY KEY,
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      movement_id INTEGER NOT NULL REFERENCES asset_movements(id),
      filename VARCHAR(80) NOT NULL,
      mime_type VARCHAR(30) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png')),
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_decommission_photos_asset ON asset_decommission_photos(asset_id);`);

  // Plan 013: las bajas contables ya confirmadas dejan el activo en WRITTEN_OFF (idempotente).
  await postgres.query(`
    UPDATE assets a
       SET status_id = (SELECT id FROM asset_statuses WHERE code = 'WRITTEN_OFF'), updated_at = now()
      FROM asset_accounting aa, asset_statuses s
     WHERE aa.asset_id = a.id AND aa.stage = 'WRITTEN_OFF'
       AND s.id = a.status_id AND s.code = 'DECOMMISSIONED';
  `);
}

// Service Desk ITIL v4 (plan 009): configuracion (grupos, categorias,
// catalogo, calendario habil, matriz de prioridad, SLA) e incidentes/
// solicitudes con su linea de tiempo insert-only. Los *_user_id / *_by son
// usuarios de MSSQL, sin FK real (mismo criterio que el resto del proyecto).
async function migrateServiceDesk(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS support_groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      description VARCHAR(255),
      email VARCHAR(160),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS support_group_members (
      group_id INTEGER NOT NULL REFERENCES support_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      is_lead BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_support_group_members_user ON support_group_members(user_id);`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_categories (
      id SERIAL PRIMARY KEY,
      parent_id INTEGER REFERENCES service_categories(id),
      name VARCHAR(80) NOT NULL,
      default_group_id INTEGER REFERENCES support_groups(id),
      applies_to VARCHAR(20)[] NOT NULL DEFAULT ARRAY['INCIDENT','SERVICE_REQUEST']::VARCHAR(20)[],
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_service_categories_name
      ON service_categories (COALESCE(parent_id, 0), lower(name));
  `);
  await assertIndexExists("uq_service_categories_name");

  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_catalog_items (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      description VARCHAR(500),
      category_id INTEGER REFERENCES service_categories(id),
      default_group_id INTEGER REFERENCES support_groups(id),
      approval_group_id INTEGER REFERENCES support_groups(id),
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS business_calendars (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL UNIQUE,
      timezone VARCHAR(60) NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  // Un solo calendario por defecto (el que usa el SLA si la politica no fija otro).
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_business_calendars_default ON business_calendars (is_default) WHERE is_default;
  `);
  await assertIndexExists("uq_business_calendars_default");
  await runDdl(`
    CREATE TABLE IF NOT EXISTS business_hours (
      id SERIAL PRIMARY KEY,
      calendar_id INTEGER NOT NULL REFERENCES business_calendars(id) ON DELETE CASCADE,
      weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      CHECK (end_time > start_time)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_business_hours_calendar ON business_hours(calendar_id);`);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS business_holidays (
      calendar_id INTEGER NOT NULL REFERENCES business_calendars(id) ON DELETE CASCADE,
      holiday_date DATE NOT NULL,
      name VARCHAR(120) NOT NULL,
      PRIMARY KEY (calendar_id, holiday_date)
    );
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS priority_matrix (
      impact SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 3),
      urgency SMALLINT NOT NULL CHECK (urgency BETWEEN 1 AND 3),
      priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
      PRIMARY KEY (impact, urgency)
    );
  `);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS sla_policies (
      id SERIAL PRIMARY KEY,
      ticket_type VARCHAR(20) NOT NULL CHECK (ticket_type IN ('INCIDENT','SERVICE_REQUEST')),
      priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
      response_minutes INTEGER NOT NULL CHECK (response_minutes > 0),
      resolution_minutes INTEGER NOT NULL CHECK (resolution_minutes > 0),
      calendar_id INTEGER REFERENCES business_calendars(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ticket_type, priority)
    );
  `);

  // Correlativo del folio por prefijo y anio (ver numbering.ts). Mismo incremento
  // atomico que inventory_count_counters: upsert con RETURNING.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_desk_counters (
      prefix VARCHAR(5) NOT NULL,
      year INTEGER NOT NULL,
      next_seq INTEGER NOT NULL,
      PRIMARY KEY (prefix, year)
    );
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_tickets (
      id SERIAL PRIMARY KEY,
      number VARCHAR(20) NOT NULL UNIQUE,
      type VARCHAR(20) NOT NULL CHECK (type IN ('INCIDENT','SERVICE_REQUEST')),
      status VARCHAR(20) NOT NULL CHECK (status IN
        ('PENDING_APPROVAL','NEW','ASSIGNED','IN_PROGRESS','ON_HOLD','RESOLVED','CLOSED','CANCELLED')),
      on_hold_reason VARCHAR(20),
      title VARCHAR(160) NOT NULL,
      description TEXT NOT NULL,
      category_id INTEGER REFERENCES service_categories(id),
      catalog_item_id INTEGER REFERENCES service_catalog_items(id),
      variables JSONB NOT NULL DEFAULT '{}'::jsonb,
      impact SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 3),
      urgency SMALLINT NOT NULL CHECK (urgency BETWEEN 1 AND 3),
      priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
      channel VARCHAR(10) NOT NULL CHECK (channel IN ('PORTAL','PHONE','EMAIL','WALK_IN','AGENT')),
      is_major BOOLEAN NOT NULL DEFAULT false,
      requester_user_id INTEGER NOT NULL,
      opened_by INTEGER NOT NULL,
      assigned_group_id INTEGER REFERENCES support_groups(id),
      assignee_user_id INTEGER,
      parent_ticket_id INTEGER REFERENCES service_tickets(id),
      resolution_code VARCHAR(20),
      resolution_notes TEXT,
      calendar_id INTEGER REFERENCES business_calendars(id),
      sla_start_at TIMESTAMPTZ,
      response_minutes INTEGER,
      resolution_minutes INTEGER,
      response_due_at TIMESTAMPTZ,
      resolution_due_at TIMESTAMPTZ,
      resolution_warn_at TIMESTAMPTZ,
      sla_paused_minutes INTEGER NOT NULL DEFAULT 0,
      on_hold_since TIMESTAMPTZ,
      first_response_at TIMESTAMPTZ,
      response_breached BOOLEAN NOT NULL DEFAULT false,
      resolution_breached BOOLEAN NOT NULL DEFAULT false,
      warned_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER,
      auto_close_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      reopen_count INTEGER NOT NULL DEFAULT 0,
      csat_score SMALLINT CHECK (csat_score BETWEEN 1 AND 5),
      csat_comment VARCHAR(500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (status <> 'ON_HOLD' OR (on_hold_reason IS NOT NULL AND on_hold_since IS NOT NULL)),
      CHECK (status NOT IN ('RESOLVED','CLOSED') OR (resolution_code IS NOT NULL AND resolved_at IS NOT NULL))
    );
  `);
  // Grupo aprobador fijado al crear la solicitud (run-3 final, L6). Las pendientes de antes toman el del item.
  await runDdl(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS approval_group_id INTEGER REFERENCES support_groups(id);`);
  await runDdl(`
    UPDATE service_tickets t SET approval_group_id = ci.approval_group_id
      FROM service_catalog_items ci
     WHERE ci.id = t.catalog_item_id AND t.status = 'PENDING_APPROVAL' AND t.approval_group_id IS NULL;
  `);
  await migrateEquipmentRequests();
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_tickets_status ON service_tickets(status);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_tickets_group ON service_tickets(assigned_group_id, status);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_tickets_assignee ON service_tickets(assignee_user_id, status);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_tickets_requester ON service_tickets(requester_user_id, id DESC);`);
  // Barrido de SLA (slaSweeper): solo los tickets con reloj corriendo.
  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_service_tickets_sla ON service_tickets(resolution_due_at)
      WHERE status IN ('NEW','ASSIGNED','IN_PROGRESS');
  `);
  await runDdl(`
    CREATE INDEX IF NOT EXISTS ix_service_tickets_auto_close ON service_tickets(auto_close_at) WHERE status = 'RESOLVED';
  `);

  // Linea de tiempo y auditoria: solo INSERT. is_public = visible para el solicitante.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_ticket_events (
      id BIGSERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES service_tickets(id),
      event_type VARCHAR(30) NOT NULL,
      actor_user_id INTEGER,
      is_public BOOLEAN NOT NULL DEFAULT false,
      body TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_ticket_events_ticket ON service_ticket_events(ticket_id, id);`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_ticket_attachments (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES service_tickets(id),
      is_public BOOLEAN NOT NULL DEFAULT true,
      original_name VARCHAR(160) NOT NULL,
      stored_name VARCHAR(80) NOT NULL,
      mime_type VARCHAR(60) NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      uploaded_by INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_ticket_attachments_ticket ON service_ticket_attachments(ticket_id);`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_ticket_approvals (
      id SERIAL PRIMARY KEY,
      ticket_id INTEGER NOT NULL REFERENCES service_tickets(id),
      approver_user_id INTEGER NOT NULL,
      decision VARCHAR(10) NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
      comment VARCHAR(500),
      decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ticket_id, approver_user_id)
    );
  `);

  // Activos involucrados. holder_user_id / status_before: foto al vincular,
  // para devolver el activo a quien lo tenia al salir de soporte.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_ticket_assets (
      ticket_id INTEGER NOT NULL REFERENCES service_tickets(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      holder_user_id INTEGER,
      status_before VARCHAR(30),
      support_movement_id INTEGER REFERENCES asset_movements(id),
      return_movement_id INTEGER REFERENCES asset_movements(id),
      linked_by INTEGER NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ticket_id, asset_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_ticket_assets_asset ON service_ticket_assets(asset_id);`);
  // Un activo solo puede estar "en soporte" por UN ticket a la vez.
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_service_ticket_assets_in_support ON service_ticket_assets(asset_id)
      WHERE support_movement_id IS NOT NULL AND return_movement_id IS NULL;
  `);
  await assertIndexExists("uq_service_ticket_assets_in_support");

  await migrateServiceProblems();
  await migrateServiceChanges();
  await migrateKnowledgeBase();

  // Auditoria de la configuracion (run-3, F6): solo INSERT, igual que las lineas de tiempo.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_desk_audit_log (
      id BIGSERIAL PRIMARY KEY,
      entity VARCHAR(40) NOT NULL,
      entity_id INTEGER,
      action VARCHAR(10) NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','REPLACE')),
      actor_user_id INTEGER NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_desk_audit_log_entity ON service_desk_audit_log(entity, id);`);
  // Insert-only forzado en la base (run-3 final, L5), no solo por convencion.
  await runDdl(`
    CREATE OR REPLACE FUNCTION service_desk_audit_log_immutable() RETURNS trigger AS $fn$
    BEGIN
      RAISE EXCEPTION 'service_desk_audit_log es solo de insercion';
    END;
    $fn$ LANGUAGE plpgsql;
  `);
  await runDdl(`DROP TRIGGER IF EXISTS trg_service_desk_audit_log_immutable ON service_desk_audit_log;`);
  await runDdl(`
    CREATE TRIGGER trg_service_desk_audit_log_immutable
      BEFORE UPDATE OR DELETE OR TRUNCATE ON service_desk_audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION service_desk_audit_log_immutable();
  `);

  await seedServiceDeskDefaults();
}

// Gestion de problemas (plan 009, fase 9C): causa raiz de incidentes
// recurrentes. Un incidente apunta a su problema (service_tickets.problem_id).
async function migrateServiceProblems(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_problems (
      id SERIAL PRIMARY KEY,
      number VARCHAR(20) NOT NULL UNIQUE,
      status VARCHAR(20) NOT NULL CHECK (status IN
        ('NEW','UNDER_INVESTIGATION','KNOWN_ERROR','RESOLVED','CLOSED','CANCELLED')),
      title VARCHAR(160) NOT NULL,
      description TEXT NOT NULL,
      category_id INTEGER REFERENCES service_categories(id),
      impact SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 3),
      urgency SMALLINT NOT NULL CHECK (urgency BETWEEN 1 AND 3),
      priority VARCHAR(2) NOT NULL CHECK (priority IN ('P1','P2','P3','P4')),
      assigned_group_id INTEGER REFERENCES support_groups(id),
      assignee_user_id INTEGER,
      root_cause TEXT,
      workaround TEXT,
      permanent_fix TEXT,
      -- Sin FK: kb_articles referencia a su vez a service_problems (source_problem_id).
      kb_article_id INTEGER,
      created_by INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      known_error_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      resolved_by INTEGER,
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      CHECK (status <> 'KNOWN_ERROR' OR workaround IS NOT NULL),
      CHECK (status NOT IN ('RESOLVED','CLOSED') OR (root_cause IS NOT NULL AND permanent_fix IS NOT NULL))
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_problems_status ON service_problems(status);`);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_problem_assets (
      problem_id INTEGER NOT NULL REFERENCES service_problems(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      linked_by INTEGER NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (problem_id, asset_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_problem_assets_asset ON service_problem_assets(asset_id);`);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_problem_events (
      id BIGSERIAL PRIMARY KEY,
      problem_id INTEGER NOT NULL REFERENCES service_problems(id),
      event_type VARCHAR(30) NOT NULL,
      actor_user_id INTEGER,
      body TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_problem_events_problem ON service_problem_events(problem_id, id);`);
  await runDdl(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS problem_id INTEGER REFERENCES service_problems(id);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_tickets_problem ON service_tickets(problem_id) WHERE problem_id IS NOT NULL;`);
}

// Habilitacion de cambios (plan 009, fase 9D): RFC estandar (plantilla
// preaprobada), normal (CAB: todos aprueban) o de emergencia (ECAB: uno).
async function migrateServiceChanges(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS standard_change_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      description VARCHAR(500),
      category_id INTEGER REFERENCES service_categories(id),
      implementation_plan TEXT NOT NULL,
      backout_plan TEXT NOT NULL,
      test_plan TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_changes (
      id SERIAL PRIMARY KEY,
      number VARCHAR(20) NOT NULL UNIQUE,
      type VARCHAR(10) NOT NULL CHECK (type IN ('STANDARD','NORMAL','EMERGENCY')),
      status VARCHAR(20) NOT NULL CHECK (status IN
        ('DRAFT','ASSESSMENT','CAB_APPROVAL','SCHEDULED','IMPLEMENTING','REVIEW','CLOSED','REJECTED','CANCELLED')),
      title VARCHAR(160) NOT NULL,
      description TEXT NOT NULL,
      justification TEXT,
      category_id INTEGER REFERENCES service_categories(id),
      risk VARCHAR(10) NOT NULL DEFAULT 'MEDIUM' CHECK (risk IN ('LOW','MEDIUM','HIGH')),
      impact SMALLINT NOT NULL DEFAULT 2 CHECK (impact BETWEEN 1 AND 3),
      implementation_plan TEXT,
      backout_plan TEXT,
      test_plan TEXT,
      planned_start TIMESTAMPTZ,
      planned_end TIMESTAMPTZ,
      actual_start TIMESTAMPTZ,
      actual_end TIMESTAMPTZ,
      outcome VARCHAR(20) CHECK (outcome IN ('SUCCESSFUL','FAILED','BACKED_OUT')),
      pir_notes TEXT,
      requested_by INTEGER NOT NULL,
      assigned_group_id INTEGER REFERENCES support_groups(id),
      assignee_user_id INTEGER,
      problem_id INTEGER REFERENCES service_problems(id),
      template_id INTEGER REFERENCES standard_change_templates(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      closed_by INTEGER,
      CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end > planned_start),
      CHECK (status <> 'CLOSED' OR outcome IS NOT NULL)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_changes_status ON service_changes(status);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_changes_window ON service_changes(planned_start, planned_end);`);
  // Una fila por aprobador pedido; decision NULL = pendiente.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_change_approvals (
      id SERIAL PRIMARY KEY,
      change_id INTEGER NOT NULL REFERENCES service_changes(id),
      approver_user_id INTEGER NOT NULL,
      decision VARCHAR(10) CHECK (decision IN ('APPROVED','REJECTED')),
      comment VARCHAR(500),
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at TIMESTAMPTZ,
      UNIQUE (change_id, approver_user_id)
    );
  `);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_change_assets (
      change_id INTEGER NOT NULL REFERENCES service_changes(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      linked_by INTEGER NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (change_id, asset_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_change_assets_asset ON service_change_assets(asset_id);`);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_change_tickets (
      change_id INTEGER NOT NULL REFERENCES service_changes(id),
      ticket_id INTEGER NOT NULL REFERENCES service_tickets(id),
      linked_by INTEGER NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (change_id, ticket_id)
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_change_tickets_ticket ON service_change_tickets(ticket_id);`);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_change_events (
      id BIGSERIAL PRIMARY KEY,
      change_id INTEGER NOT NULL REFERENCES service_changes(id),
      event_type VARCHAR(30) NOT NULL,
      actor_user_id INTEGER,
      body TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_service_change_events_change ON service_change_events(change_id, id);`);
}

// Gestion del conocimiento (plan 009, fase 9E). El cuerpo es texto plano (sin
// HTML: se muestra escapado). search_vector: busqueda en espanol.
async function migrateKnowledgeBase(): Promise<void> {
  await runDdl(`
    CREATE TABLE IF NOT EXISTS kb_articles (
      id SERIAL PRIMARY KEY,
      number VARCHAR(20) NOT NULL UNIQUE,
      title VARCHAR(160) NOT NULL,
      body TEXT NOT NULL,
      category_id INTEGER REFERENCES service_categories(id),
      audience VARCHAR(10) NOT NULL CHECK (audience IN ('PUBLIC','INTERNAL')),
      status VARCHAR(10) NOT NULL CHECK (status IN ('DRAFT','IN_REVIEW','PUBLISHED','RETIRED')),
      version INTEGER NOT NULL DEFAULT 0,
      author_id INTEGER NOT NULL,
      published_by INTEGER,
      published_at TIMESTAMPTZ,
      source_problem_id INTEGER REFERENCES service_problems(id),
      helpful_yes INTEGER NOT NULL DEFAULT 0,
      helpful_no INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish'::regconfig, coalesce(title, '')), 'A') ||
        setweight(to_tsvector('spanish'::regconfig, coalesce(body, '')), 'B')
      ) STORED
    );
  `);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_kb_articles_search ON kb_articles USING GIN (search_vector);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_kb_articles_status ON kb_articles(status, audience);`);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS kb_article_versions (
      article_id INTEGER NOT NULL REFERENCES kb_articles(id),
      version INTEGER NOT NULL,
      title VARCHAR(160) NOT NULL,
      body TEXT NOT NULL,
      published_by INTEGER NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (article_id, version)
    );
  `);
  // Un voto por usuario y articulo (los contadores del articulo se derivan de aca).
  await runDdl(`
    CREATE TABLE IF NOT EXISTS kb_article_feedback (
      article_id INTEGER NOT NULL REFERENCES kb_articles(id),
      user_id INTEGER NOT NULL,
      helpful BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (article_id, user_id)
    );
  `);
  await runDdl(`
    CREATE TABLE IF NOT EXISTS service_ticket_kb (
      ticket_id INTEGER NOT NULL REFERENCES service_tickets(id),
      article_id INTEGER NOT NULL REFERENCES kb_articles(id),
      used_to_resolve BOOLEAN NOT NULL DEFAULT false,
      linked_by INTEGER NOT NULL,
      linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (ticket_id, article_id)
    );
  `);
}

// Configuracion inicial: solo si la tabla esta vacia, para no pisar lo que se
// edite desde "Configuración Service Desk". Corre bajo el advisory lock de la
// migracion (una sola replica a la vez).
async function seedServiceDeskDefaults(): Promise<void> {
  const isEmpty = async (table: string): Promise<boolean> => {
    const rows = await postgres.query(`SELECT 1 FROM ${table} LIMIT 1`, { type: QueryTypes.SELECT });
    return rows.length === 0;
  };

  if (await isEmpty("priority_matrix")) {
    for (const row of DEFAULT_PRIORITY_MATRIX) {
      await postgres.query(
        `INSERT INTO priority_matrix (impact, urgency, priority) VALUES (:impact, :urgency, :priority) ON CONFLICT DO NOTHING`,
        { replacements: row },
      );
    }
  }

  if (await isEmpty("business_calendars")) {
    await postgres.transaction(async (transaction) => {
      const [calendar] = await postgres.query<{ id: number }>(
        `INSERT INTO business_calendars (name, timezone, is_default) VALUES (:name, :timezone, true) RETURNING id`,
        { replacements: { name: DEFAULT_CALENDAR.name, timezone: DEFAULT_CALENDAR.timezone }, type: QueryTypes.SELECT, transaction },
      );
      for (const hour of DEFAULT_CALENDAR.hours) {
        await postgres.query(
          `INSERT INTO business_hours (calendar_id, weekday, start_time, end_time) VALUES (:calendarId, :weekday, :start, :end)`,
          { replacements: { calendarId: calendar!.id, ...hour }, transaction },
        );
      }
      for (const holiday of DEFAULT_HOLIDAYS) {
        await postgres.query(
          `INSERT INTO business_holidays (calendar_id, holiday_date, name) VALUES (:calendarId, :date, :name)`,
          { replacements: { calendarId: calendar!.id, ...holiday }, transaction },
        );
      }
    });
  }

  if (await isEmpty("sla_policies")) {
    for (const policy of DEFAULT_SLA_POLICIES) {
      await postgres.query(
        `INSERT INTO sla_policies (ticket_type, priority, response_minutes, resolution_minutes)
         VALUES (:ticketType, :priority, :responseMinutes, :resolutionMinutes) ON CONFLICT DO NOTHING`,
        { replacements: policy },
      );
    }
  }

  if (await isEmpty("support_groups")) {
    for (const group of DEFAULT_GROUPS) {
      await postgres.query(`INSERT INTO support_groups (name, description) VALUES (:name, :description) ON CONFLICT DO NOTHING`, {
        replacements: group,
      });
    }
  }

  if (await isEmpty("service_categories")) {
    for (const category of DEFAULT_CATEGORIES) {
      await postgres.query(
        `INSERT INTO service_categories (name, default_group_id, applies_to)
         VALUES (:name, (SELECT id FROM support_groups WHERE name = :group), ARRAY[:appliesTo]::VARCHAR(20)[])
         ON CONFLICT DO NOTHING`,
        { replacements: category },
      );
    }
  }

  if (await isEmpty("service_catalog_items")) {
    for (const item of DEFAULT_CATALOG_ITEMS) {
      await postgres.query(
        `INSERT INTO service_catalog_items (name, description, category_id, default_group_id, fields, fulfillment)
         SELECT :name, :description, c.id, c.default_group_id, CAST(:fields AS JSONB), :fulfillment
           FROM service_categories c WHERE c.parent_id IS NULL AND c.name = :category
         ON CONFLICT DO NOTHING`,
        { replacements: { ...item, fields: JSON.stringify(item.fields), fulfillment: item.fulfillment ?? null } },
      );
    }
  }

  await migrateSupportGroupCodes();
}

// Codigo de 2 digitos de cada grupo (01, 02...) que va en el folio de los
// tickets, problemas y cambios que el grupo recibe al crearse (numbering.ts).
// 00 queda reservado para "sin grupo". Los grupos sin codigo (los de antes de
// esta columna y los sembrados arriba, en orden de id: Mesa de Ayuda N1 = 01,
// Soporte N2 = 02, Infraestructura = 03) toman el siguiente libre. Los codigos
// no se reutilizan: los grupos se desactivan, no se borran.
async function migrateSupportGroupCodes(): Promise<void> {
  await runDdl(`ALTER TABLE support_groups ADD COLUMN IF NOT EXISTS code CHAR(2)
    CONSTRAINT ck_support_groups_code CHECK (code ~ '^[0-9]{2}$' AND code <> '00');`);
  await postgres.query(`
    UPDATE support_groups g
       SET code = lpad((base.max_code + pending.rn)::text, 2, '0')
      FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM support_groups WHERE code IS NULL) pending,
           (SELECT COALESCE(MAX(code::int), 0) AS max_code FROM support_groups) base
     WHERE g.id = pending.id`);
  await runDdl(`CREATE UNIQUE INDEX IF NOT EXISTS ux_support_groups_code ON support_groups(code);`);
  await assertIndexExists("ux_support_groups_code");
}

// Solicitud de equipo desde el portal (plan 010): un item del catalogo con
// fulfillment = 'PURCHASE_REQUEST' crea, junto con el ticket, la solicitud de
// compra en MSSQL. purchase_request_id es cross-engine (sin FK, igual que
// requester_user_id); purchase_request_number (SOL...) se muestra aunque MSSQL
// no responda, y purchase_request_status es el ultimo estado de la compra ya
// aplicado al ticket (la sincronizacion compara contra el).
async function migrateEquipmentRequests(): Promise<void> {
  // Una sola vez, en la misma transaccion que crea la columna: el item sembrado
  // "Solicitud de equipo" pasa a generar la compra (sin grupo aprobador, la
  // aprueba el aprobador de la compra; sin el campo "equipo", lo reemplazan las
  // lineas de producto) y todo rol con la pantalla retirada "Nueva Solicitud"
  // recibe "Generar Ticket". Despues el admin puede cambiar el item y no se pisa.
  const fulfillmentDdl = `ALTER TABLE service_catalog_items ADD COLUMN IF NOT EXISTS fulfillment VARCHAR(30)
    CONSTRAINT ck_service_catalog_items_fulfillment CHECK (fulfillment IN ('PURCHASE_REQUEST'))`;
  if (!(await alreadyApplied(fulfillmentDdl))) {
    await postgres.transaction(async (transaction) => {
      await postgres.query(`SET LOCAL lock_timeout = ${DDL_LOCK_TIMEOUT_MS}`, { transaction });
      await postgres.query(fulfillmentDdl, { transaction });
      await postgres.query(
        `UPDATE service_catalog_items
            SET fulfillment = 'PURCHASE_REQUEST', approval_group_id = NULL, updated_at = now(),
                fields = COALESCE((SELECT jsonb_agg(f) FROM jsonb_array_elements(fields) f WHERE f->>'key' <> 'equipo'), '[]'::jsonb)
          WHERE name = :name`,
        { replacements: { name: EQUIPMENT_REQUEST_ITEM_NAME }, transaction },
      );
      await postgres.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT rp.role_id, g.id
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id AND p.resource = 'purchase-request-creation' AND p.action = 'access'
           JOIN permissions g ON g.resource = 'generate-ticket' AND g.action = 'access'
         ON CONFLICT DO NOTHING`,
        { transaction },
      );
    });
  }
  await runDdl(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS purchase_request_id INTEGER;`);
  await runDdl(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS purchase_request_number VARCHAR(20);`);
  await runDdl(`ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS purchase_request_status VARCHAR(20);`);
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_service_tickets_purchase_request ON service_tickets(purchase_request_id)
      WHERE purchase_request_id IS NOT NULL;
  `);
  await assertIndexExists("ux_service_tickets_purchase_request");
}

// Toma de inventario fisica (levantamiento por un auditor). Ver
// .claude/planes/002-toma-inventario-activos.html. Todo Postgres: crear el
// activo, su movimiento y la linea de la toma corre en UNA transaccion.
// holder_user_id / product_* son referencias cross-engine (MSSQL / Mongo) sin
// FK real, mismo criterio que assets.product_id y asset_movement_users.user_id.
async function migrateInventoryCounts(): Promise<void> {
  // Folio legible por anio (IT-AAAA-NNNNNN). El upsert con RETURNING es el
  // incremento atomico (mismo criterio que asset_tag_counters), sin seed: la
  // fila del anio nace en el primer folio.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS inventory_count_counters (
      year INTEGER PRIMARY KEY,
      next_seq INTEGER NOT NULL DEFAULT 0
    );
  `);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS inventory_counts (
      id SERIAL PRIMARY KEY,
      number VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      notes VARCHAR(500),
      status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      created_by INTEGER,
      closed_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Un auditor no abre dos tomas a la vez: la unicidad la garantiza el motor
  // (el guard de aplicacion no seria atomico entre las 3 replicas).
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_counts_open_per_creator
      ON inventory_counts(created_by) WHERE status = 'OPEN';
  `);
  await assertIndexExists("ux_inventory_counts_open_per_creator");

  await runDdl(`
    CREATE TABLE IF NOT EXISTS inventory_count_lines (
      id SERIAL PRIMARY KEY,
      inventory_count_id INTEGER NOT NULL REFERENCES inventory_counts(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      asset_created BOOLEAN NOT NULL DEFAULT FALSE,
      product_category_id VARCHAR(24) NOT NULL,
      product_id VARCHAR(24) NOT NULL,
      description VARCHAR(255),
      cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
      serial_number VARCHAR(100),
      holder_user_id INTEGER,
      status_code VARCHAR(20) NOT NULL CHECK (status_code IN ('ASSIGNED','SUPPORT','AVAILABLE','DAMAGED','DECOMMISSIONED')),
      system_status_code VARCHAR(30),
      system_holder_user_id INTEGER,
      system_serial_number VARCHAR(100),
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (inventory_count_id, asset_id)
    );
  `);

  // Plan 003: los activos existentes ahora se ACTUALIZAN desde la toma. Se guarda
  // el centro de costo previo (snapshot), el estado en que quedo el activo y si
  // la toma lo modifico (una linea modificada ya no se puede quitar: revertiria
  // solo la linea, no el cambio). La serie de un activo existente ya no la edita
  // el auditor (se carga del activo), asi que su snapshot sobra.
  await runDdl(`ALTER TABLE inventory_count_lines ADD COLUMN IF NOT EXISTS system_cost_center_id INTEGER;`);
  await runDdl(`ALTER TABLE inventory_count_lines ADD COLUMN IF NOT EXISTS resulting_status_code VARCHAR(30);`);
  await runDdl(`ALTER TABLE inventory_count_lines ADD COLUMN IF NOT EXISTS asset_modified BOOLEAN NOT NULL DEFAULT FALSE;`);
  await runDdl(`ALTER TABLE inventory_count_lines DROP COLUMN IF EXISTS system_serial_number;`);

  await runDdl(`
    CREATE TABLE IF NOT EXISTS inventory_count_missing_assets (
      id SERIAL PRIMARY KEY,
      inventory_count_id INTEGER NOT NULL REFERENCES inventory_counts(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      system_status_code VARCHAR(30) NOT NULL,
      system_holder_user_id INTEGER,
      UNIQUE (inventory_count_id, asset_id)
    );
  `);
}

// Devoluciones de activos a Adquisiciones TI (plan 004). Una devolucion agrupa
// activos de UN centro de costo, lleva una guia de despacho en PDF cuyo nombre
// es el codigo (DEV<centro><aaaammddHHmmssSSS>) y pasa DRAFT -> SENT -> RECEIVED
// (o CANCELLED desde DRAFT). "Recibida parcialmente" no es un estado: es SENT
// con lineas ya recibidas.
async function migrateAssetReturns(): Promise<void> {
  // code es NULL hasta que se adjunta la guia por primera vez (UNIQUE admite
  // varios NULL en Postgres). requested_by/sent_by/received_by son referencias
  // cross-engine a users (MSSQL), sin FK real.
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_returns (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) UNIQUE,
      cost_center_id INTEGER NOT NULL REFERENCES cost_centers(id),
      holder_scope VARCHAR(6) NOT NULL DEFAULT 'OTHERS',
      status VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','RECEIVED','CANCELLED')),
      document_filename VARCHAR(80),
      notes VARCHAR(500),
      requested_by INTEGER,
      sent_at TIMESTAMPTZ,
      sent_by INTEGER,
      received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // holder_scope: OWN = el solicitante devuelve equipos asignados a EL (el centro de costo lo define el activo);
  // OTHERS = equipos asignados a otro usuario (el solicitante elige el centro de costo). Una devolucion no mezcla
  // ambos. Tablas creadas antes de esta columna la reciben con OTHERS.
  await runDdl(`ALTER TABLE asset_returns ADD COLUMN IF NOT EXISTS holder_scope VARCHAR(6) NOT NULL DEFAULT 'OTHERS';`);

  // holder_user_id/previous_status_code: foto al agregar el activo (el nombre
  // del usuario se resuelve al leer, no se copia). active = la linea sigue
  // vigente (devolucion en borrador o enviada y activo aun no recibido).
  await runDdl(`
    CREATE TABLE IF NOT EXISTS asset_return_lines (
      id SERIAL PRIMARY KEY,
      asset_return_id INTEGER NOT NULL REFERENCES asset_returns(id),
      asset_id INTEGER NOT NULL REFERENCES assets(id),
      holder_user_id INTEGER,
      previous_status_code VARCHAR(30) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      received_at TIMESTAMPTZ,
      received_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (asset_return_id, asset_id)
    );
  `);

  // Un activo solo puede estar en UNA devolucion vigente: lo garantiza el motor
  // (un guard de aplicacion no seria atomico entre las 3 replicas).
  await runDdl(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_asset_return_lines_active_asset
      ON asset_return_lines(asset_id) WHERE active;
  `);
  await assertIndexExists("ux_asset_return_lines_active_asset");
}

// CHECK/FK/indices de integridad y rendimiento de la toma de inventario y las devoluciones. Todo
// idempotente y barato en cada arranque: se consulta el catalogo y solo se ejecuta el DDL que falta. Los
// CHECK/FK nuevos van NOT VALID: se aplican a toda fila nueva sin escanear (ni bloquear) las existentes.
async function constraintExists(name: string): Promise<boolean> {
  const rows = await postgres.query(`SELECT 1 FROM pg_constraint WHERE conname = :name`, {
    replacements: { name },
    type: QueryTypes.SELECT,
  });
  return rows.length > 0;
}

async function ensureConstraint(name: string, alterSql: string): Promise<void> {
  if (await constraintExists(name)) return;
  await runDdl(alterSql);
}

async function migrateIntegrityAndIndexes(): Promise<void> {
  // asset_return_lines es historial de quien devolvio que: un ON DELETE CASCADE lo borraria junto con la
  // cabecera y liberaria el indice parcial con activos aun en transito. El resto del esquema usa FK restrictivas.
  const fk = await postgres.query<{ deltype: string }>(
    `SELECT confdeltype AS deltype FROM pg_constraint WHERE conname = 'asset_return_lines_asset_return_id_fkey'`,
    { type: QueryTypes.SELECT },
  );
  if (fk[0]?.deltype === "c") {
    await runDdl(`
      ALTER TABLE asset_return_lines
        DROP CONSTRAINT asset_return_lines_asset_return_id_fkey,
        ADD CONSTRAINT asset_return_lines_asset_return_id_fkey FOREIGN KEY (asset_return_id) REFERENCES asset_returns(id);
    `);
  }

  await ensureConstraint(
    "asset_return_lines_received_inactive",
    `ALTER TABLE asset_return_lines ADD CONSTRAINT asset_return_lines_received_inactive
       CHECK (NOT (active AND received_at IS NOT NULL)) NOT VALID;`,
  );
  await ensureConstraint(
    "asset_returns_sent_requires_document",
    `ALTER TABLE asset_returns ADD CONSTRAINT asset_returns_sent_requires_document
       CHECK (status NOT IN ('SENT','RECEIVED') OR (code IS NOT NULL AND document_filename IS NOT NULL AND sent_at IS NOT NULL)) NOT VALID;`,
  );
  await ensureConstraint(
    "asset_returns_received_requires_date",
    `ALTER TABLE asset_returns ADD CONSTRAINT asset_returns_received_requires_date
       CHECK (status <> 'RECEIVED' OR received_at IS NOT NULL) NOT VALID;`,
  );
  await ensureConstraint(
    "asset_returns_holder_scope_allowed",
    `ALTER TABLE asset_returns ADD CONSTRAINT asset_returns_holder_scope_allowed
       CHECK (holder_scope IN ('OWN','OTHERS')) NOT VALID;`,
  );
  await ensureConstraint(
    "inventory_counts_closed_consistent",
    `ALTER TABLE inventory_counts ADD CONSTRAINT inventory_counts_closed_consistent
       CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL)) NOT VALID;`,
  );
  await ensureConstraint(
    "inventory_count_lines_system_cost_center_fkey",
    `ALTER TABLE inventory_count_lines ADD CONSTRAINT inventory_count_lines_system_cost_center_fkey
       FOREIGN KEY (system_cost_center_id) REFERENCES cost_centers(id) NOT VALID;`,
  );

  // Candidatos de devolucion (por centro de costo), pendientes de valorizacion (value NULL), busqueda por
  // serie sin distinguir mayusculas ni espacios de borde (misma expresion que findAssetsBySerial), ultimo
  // movimiento de cada activo (tenedor vigente) y los listados/filtros de devoluciones. No unico: hay series
  // repetidas en datos legados.
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_assets_cost_center_id ON assets(cost_center_id);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_assets_pending_value ON assets(id) WHERE value IS NULL;`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_assets_serial_normalized ON assets (lower(btrim(serial_number)));`);
  await runDdl(
    `CREATE INDEX IF NOT EXISTS ix_asset_movements_asset_date ON asset_movements(asset_id, movement_date DESC, id DESC);`,
  );
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_returns_status ON asset_returns(status);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_returns_cost_center_id ON asset_returns(cost_center_id);`);
  await runDdl(`CREATE INDEX IF NOT EXISTS ix_asset_returns_requested_by ON asset_returns(requested_by) WHERE status = 'DRAFT';`);

  // Los NOT VALID protegen las filas nuevas, pero una constraint sin validar no le sirve al planificador ni
  // garantiza las filas viejas. Las tablas son pequenas: se validan (best-effort: si hay filas historicas que
  // la violan solo se avisa, el arranque no se cae).
  const toValidate: [string, string][] = [
    ["asset_return_lines", "asset_return_lines_received_inactive"],
    ["asset_returns", "asset_returns_sent_requires_document"],
    ["asset_returns", "asset_returns_received_requires_date"],
    ["asset_returns", "asset_returns_holder_scope_allowed"],
    ["inventory_counts", "inventory_counts_closed_consistent"],
    ["inventory_count_lines", "inventory_count_lines_system_cost_center_fkey"],
  ];
  for (const [table, name] of toValidate) {
    const state = await postgres.query<{ validated: boolean }>(
      `SELECT convalidated AS validated FROM pg_constraint WHERE conname = :name`,
      { replacements: { name }, type: QueryTypes.SELECT },
    );
    if (state[0] && !state[0].validated) {
      try {
        await postgres.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${name}`);
      } catch (err) {
        logger.warn({ err, table, name }, "No se pudo validar la constraint: hay filas historicas que la violan");
      }
    }
  }
}
