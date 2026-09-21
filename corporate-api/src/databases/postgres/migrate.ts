import { QueryTypes } from "sequelize";
import { postgres } from "./connection";
import { env } from "../../library/env";
import { logger } from "../../library/logger";
import { isDuplicateObjectError, isUniqueConstraintError } from "../../library/errors";

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

async function runDdl(sql: string): Promise<void> {
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
      ('DECOMMISSIONED', 'De baja', 'El activo fue dado de baja'),
      ('DAMAGED', 'Dañado', 'El activo esta danado y no operativo (levantado en una toma de inventario)'),
      ('RETURNED', 'Devolución', 'El activo fue devuelto por su usuario y esta pendiente de revision por Soporte TI / Adquisiciones TI'),
      ('DEVALUATED', 'Devaluado', 'Activo dado de baja que se encontro en uso: sigue asignado con valor 0, sin afectar el kardex'),
      ('MOVE_TO_RETURNED', 'En tránsito a devolución', 'El activo fue despachado con guia hacia Adquisiciones TI y aun no ha sido recibido')
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

  // El CHECK inline de arriba (nombre automatico asset_movements_movement_type_check)
  // solo conocia 4 tipos. RETURNED (devolucion), MOVE_TO_RETURNED (en transito
  // hacia Adquisiciones) y DEVALUATED (baja reactivada en una toma de
  // inventario) lo ensanchan: mismo patron DROP + ADD con nombre
  // explicito que permissions_action_allowed, para poder ensancharlo de nuevo.
  // Se reescribe SOLO si la definicion vigente no incluye todos los tipos (cada arranque de cada replica
  // hacia DROP + ADD y ese ALTER toma ACCESS EXCLUSIVE y revalida la tabla, que crece). El DROP y el ADD van
  // en UNA sentencia: no hay ventana sin CHECK entre ambos.
  const movementTypes = ['ASSIGNED', 'REASSIGNED', 'SUPPORT', 'DECOMMISSIONED', 'RETURNED', 'DEVALUATED', 'MOVE_TO_RETURNED'];
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
