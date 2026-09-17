import { mssql } from "./connection";
import { logger } from "../../library/logger";
import { isDuplicateMssqlObjectError } from "../../library/errors";

// Igual criterio que databases/postgres/migrate.ts: migracion propia de la
// app, idempotente via guards IF NOT EXISTS (MSSQL no soporta
// "CREATE TABLE IF NOT EXISTS"). El AG (corporate-infra) replica el esquema
// del primario al secundario automaticamente al ser DDL sobre una base ya
// unida al Availability Group -no hace falta correr esto contra el secundario-.
//
// El guard "IF NOT EXISTS (...) BEGIN ... END" no es atomico: con las 3
// replicas de la API migrando en paralelo contra una base recien creada,
// dos pueden pasar el chequeo casi al mismo tiempo y una choca al crear
// (ver isDuplicateMssqlObjectError). runDdl() ignora ese choque especifico
// -la otra replica ya dejo la tabla/fila en el estado correcto- y relanza
// cualquier otro error real.
async function runDdl(sql: string, replacements?: Record<string, unknown>): Promise<void> {
  try {
    await mssql.query(sql, replacements ? { replacements } : undefined);
  } catch (err) {
    if (!isDuplicateMssqlObjectError(err)) throw err;
  }
}

export async function migrateMssql(): Promise<void> {
  await migrateAuth();
  await migrateGeography();
  await migrateSupplierLookups();
  await migrateBusinessPartners();
  await migratePurchasingFlow();
  await migrateDocumentNumbering();

  logger.info("Migracion de MSSQL aplicada");
}

// Tablas lookup (no ENUM/CHECK hardcodeado) para suppliers.service_type/
// delivery_terms, mismo criterio que postgres/migrate.ts con asset_statuses:
// permiten agregar valores nuevos via API/CRUD (ver supplierServiceType.*/
// supplierDeliveryTerms.*) sin migracion. Van antes de migrateBusinessPartners
// porque suppliers tiene FK real hacia estas dos tablas.
async function migrateSupplierLookups(): Promise<void> {
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'supplier_service_types')
    BEGIN
      CREATE TABLE supplier_service_types (
        id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL UNIQUE,
        name NVARCHAR(100) NOT NULL,
        description NVARCHAR(255) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  for (const [code, name] of [
    ["ARRIENDO", "Arriendo"],
    ["SERVICIOS", "Servicios"],
    ["COMPRAS", "Compras"],
  ]) {
    await runDdl(
      `IF NOT EXISTS (SELECT 1 FROM supplier_service_types WHERE code = :code)
       INSERT INTO supplier_service_types (code, name) VALUES (:code, :name);`,
      { code, name },
    );
  }

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'supplier_delivery_terms')
    BEGIN
      CREATE TABLE supplier_delivery_terms (
        id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL UNIQUE,
        name NVARCHAR(100) NOT NULL,
        description NVARCHAR(255) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  for (const [code, name] of [
    ["ORDEN COMPRA", "Orden de compra"],
    ["CONTRA FACTURA", "Contra factura"],
    ["CREDITO", "Crédito"],
  ]) {
    await runDdl(
      `IF NOT EXISTS (SELECT 1 FROM supplier_delivery_terms WHERE code = :code)
       INSERT INTO supplier_delivery_terms (code, name) VALUES (:code, :name);`,
      { code, name },
    );
  }
}

// Contador atomico para los numeros de documento (SOL/COT/OC), ver
// library/documentNumbering.ts. Una fila por tipo, incrementada con
// "UPDATE ... OUTPUT" dentro de la MISMA transaccion que la cabecera -si esa
// transaccion hace rollback, el numero tambien se revierte (a diferencia de
// una secuencia de motor, que no hace rollback y deja "huecos"). Ver
// memoria convention-pk-id-strategy.
async function migrateDocumentNumbering(): Promise<void> {
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'document_numbering')
    BEGIN
      CREATE TABLE document_numbering (
        doc_type NVARCHAR(10) PRIMARY KEY,
        next_seq INT NOT NULL DEFAULT 0
      );
    END
  `);

  for (const docType of ["SOL", "COT", "OC"]) {
    await runDdl(
      `IF NOT EXISTS (SELECT 1 FROM document_numbering WHERE doc_type = :docType)
       INSERT INTO document_numbering (doc_type, next_seq) VALUES (:docType, 0);`,
      { docType },
    );
  }
}

async function migrateAuth(): Promise<void> {
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'persons')
    BEGIN
      CREATE TABLE persons (
        id INT IDENTITY(1,1) PRIMARY KEY,
        first_name NVARCHAR(100) NOT NULL,
        last_name NVARCHAR(100) NOT NULL,
        document_id NVARCHAR(20) NOT NULL UNIQUE,
        email NVARCHAR(150) NOT NULL UNIQUE,
        phone NVARCHAR(30) NULL,
        birth_date DATE NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'users')
    BEGIN
      CREATE TABLE users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        person_id INT NOT NULL,
        role_id INT NOT NULL,
        username NVARCHAR(50) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        last_login_at DATETIME2 NULL,
        must_change_password BIT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_users_person FOREIGN KEY (person_id) REFERENCES persons(id)
      );
    END
  `);

  // MSSQL no soporta "ADD COLUMN IF NOT EXISTS" (a diferencia de Postgres,
  // ver postgres/migrate.ts): guard manual contra sys.columns para que una
  // base que ya tenia "users" de antes de este cambio tambien termine con la
  // columna, sin chocar contra el CREATE TABLE de arriba (que ya la incluye
  // para instalaciones nuevas).
  await runDdl(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('users') AND name = 'must_change_password'
    )
    BEGIN
      ALTER TABLE users ADD must_change_password BIT NOT NULL DEFAULT 0;
    END
  `);

  // Historial de contraseñas: implementa PASSWORD_HISTORY_LIMIT (hallazgo de
  // auditoria -la env var existia pero nada la usaba, "config fantasma").
  // Solo guarda hashes VIEJOS (el hash actual vive en users.password_hash,
  // no se duplica aca) -ver changePassword en services/mssql/user.service.ts:
  // antes de cambiar, se compara la nueva contraseña contra el hash actual +
  // las ultimas N filas de aca; despues de cambiar, el hash que quedo viejo
  // se inserta aca y se podan las filas mas antiguas que las ultimas N.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'password_history')
    BEGIN
      CREATE TABLE password_history (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        password_hash NVARCHAR(255) NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_password_history_user FOREIGN KEY (user_id) REFERENCES users(id)
      );
    END
  `);

  // FK sin indice propio en MSSQL/SQL Server (a diferencia de la PK, no se
  // crea automaticamente) -changePassword consulta esta tabla por user_id 2
  // veces por cambio de contraseña, y la tabla crece sin limite con cada
  // cambio de cualquier usuario.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_password_history_user_id' AND object_id = OBJECT_ID('password_history'))
    BEGIN
      CREATE INDEX ix_password_history_user_id ON password_history(user_id);
    END
  `);
}

// Jerarquia country -> city -> states (pese al nombre, "states" es el nivel
// mas bajo -comuna en Chile, condado en otros paises- con codigos oficiales
// territorial/postal/SII). Tablas separadas y no inferidas por nombre a
// proposito: el mismo nombre puede existir en dos niveles administrativos
// distintos (la provincia de Arica vs. la ciudad de Arica, igual que "New
// York" estado vs. ciudad en EEUU) -ver memoria project-erp-scope-and-data-
// classification-.
async function migrateGeography(): Promise<void> {
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'countries')
    BEGIN
      CREATE TABLE countries (
        id INT IDENTITY(1,1) PRIMARY KEY,
        iso_code NVARCHAR(2) NOT NULL UNIQUE,
        iata_code NVARCHAR(3) NULL,
        name_country NVARCHAR(150) NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_countries_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_countries_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'cities')
    BEGIN
      CREATE TABLE cities (
        id INT IDENTITY(1,1) PRIMARY KEY,
        iata_codes NVARCHAR(20) NULL,
        name_city NVARCHAR(150) NOT NULL,
        country_id INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_cities_country FOREIGN KEY (country_id) REFERENCES countries(id),
        CONSTRAINT fk_cities_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_cities_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'states')
    BEGIN
      CREATE TABLE states (
        id INT IDENTITY(1,1) PRIMARY KEY,
        territorial_code NVARCHAR(20) NULL,
        postal_code NVARCHAR(20) NULL,
        sii_code NVARCHAR(20) NULL,
        name_state NVARCHAR(150) NOT NULL,
        city_id INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_states_city FOREIGN KEY (city_id) REFERENCES cities(id),
        CONSTRAINT fk_states_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_states_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Ni cities.iata_codes ni states.territorial_code tenian constraint UNIQUE
  // -a diferencia de countries.iso_code (arriba)-, pese a que seedCities/
  // seedStates ya asumian que lo eran (Map keyed por ese codigo). Sin el
  // constraint, el guard "count() > 0" de esos seeds no es atomico: con las
  // 3 replicas de la API arrancando en paralelo contra una base recien
  // creada, mas de una podia pasar el chequeo antes de que la primera
  // terminara de insertar, y bulkCreate() no tenia nada contra que chocar
  // -duplicaba la tabla entera en vez de fallar con isUniqueConstraintError/
  // isDuplicateMssqlObjectError como esta pensado (hallazgo: combo "Ciudad"
  // del frontend con cada region repetida). Filtrado con "WHERE ... IS NOT
  // NULL" (no UNIQUE simple) porque ambas columnas son nullable y SQL Server,
  // a diferencia de Postgres, solo permite un NULL en un indice UNIQUE
  // comun -filtrado permite varias filas sin codigo sin chocar entre si.
  //
  // El UPDATE+DELETE de abajo corre solo la primera vez (dentro del mismo
  // guard IF NOT EXISTS que crea el indice): reasigna cities/states que ya
  // hubieran quedado duplicadas hacia la fila mas antigua (MIN(id)) ANTES de
  // borrar las copias, para no romper las FK de states.city_id/addresses.
  // state_id que ya apuntaran a una de las copias.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_cities_iata_codes' AND object_id = OBJECT_ID('cities'))
    BEGIN
      ;WITH keep AS (
        SELECT iata_codes, MIN(id) AS keep_id
        FROM cities
        WHERE iata_codes IS NOT NULL
        GROUP BY iata_codes
      )
      UPDATE s
      SET s.city_id = keep.keep_id
      FROM states s
      JOIN cities dup ON dup.id = s.city_id
      JOIN keep ON keep.iata_codes = dup.iata_codes
      WHERE dup.id <> keep.keep_id;

      ;WITH keep AS (
        SELECT iata_codes, MIN(id) AS keep_id
        FROM cities
        WHERE iata_codes IS NOT NULL
        GROUP BY iata_codes
      )
      DELETE c
      FROM cities c
      JOIN keep ON keep.iata_codes = c.iata_codes
      WHERE c.id <> keep.keep_id;

      CREATE UNIQUE INDEX ux_cities_iata_codes ON cities(iata_codes) WHERE iata_codes IS NOT NULL;
    END
  `);

}

// business_partners es la entidad base (razonSocial/rut/giro compartidos);
// suppliers/customers son extensiones 1:1 -evita duplicar esos campos y el
// riesgo de inconsistencia si una misma empresa es cliente y proveedor a la
// vez (ver memoria project-erp-scope-and-data-classification). employees
// extiende persons con el mismo patron 1:1 que ya existe entre persons/users
// -no repite rut/dni: persons.document_id ya cubre eso, agregarlo de nuevo
// aca hubiera sido un campo redundante-.
async function migrateBusinessPartners(): Promise<void> {
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'business_partners')
    BEGIN
      CREATE TABLE business_partners (
        id INT IDENTITY(1,1) PRIMARY KEY,
        legal_name NVARCHAR(200) NOT NULL,
        national_id NVARCHAR(20) NOT NULL UNIQUE,
        business_line NVARCHAR(150) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_business_partners_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_business_partners_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'suppliers')
    BEGIN
      CREATE TABLE suppliers (
        id INT IDENTITY(1,1) PRIMARY KEY,
        business_partner_id INT NOT NULL UNIQUE,
        service_type_id INT NOT NULL,
        payment_term_days INT NOT NULL DEFAULT 0,
        delivery_terms_id INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_suppliers_business_partner FOREIGN KEY (business_partner_id) REFERENCES business_partners(id),
        CONSTRAINT fk_suppliers_service_type FOREIGN KEY (service_type_id) REFERENCES supplier_service_types(id),
        CONSTRAINT fk_suppliers_delivery_terms FOREIGN KEY (delivery_terms_id) REFERENCES supplier_delivery_terms(id),
        CONSTRAINT fk_suppliers_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_suppliers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // M:N Supplier<->Product (Mongo): product_id es cross-engine (ObjectId de
  // Mongo en string), sin FK real -mismo criterio que purchase_request_lines
  // /quotes/authorizations/goods_receipts.product_id. supplier_id SI tiene FK
  // real porque suppliers vive en este mismo motor.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'supplier_products')
    BEGIN
      CREATE TABLE supplier_products (
        id INT IDENTITY(1,1) PRIMARY KEY,
        supplier_id INT NOT NULL,
        product_id NVARCHAR(24) NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_supplier_products_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT uq_supplier_products UNIQUE (supplier_id, product_id),
        CONSTRAINT fk_supplier_products_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_supplier_products_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Un proveedor puede tener varios contactos (comercial, facturacion, etc.)
  // -usados para enviarles la solicitud de cotizacion por correo (ver
  // corporate-mailer, todavia no existe).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'supplier_contacts')
    BEGIN
      CREATE TABLE supplier_contacts (
        id INT IDENTITY(1,1) PRIMARY KEY,
        supplier_id INT NOT NULL,
        name NVARCHAR(150) NOT NULL,
        email NVARCHAR(150) NOT NULL,
        phone NVARCHAR(30) NULL,
        position NVARCHAR(100) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_supplier_contacts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT fk_supplier_contacts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_supplier_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customers')
    BEGIN
      CREATE TABLE customers (
        id INT IDENTITY(1,1) PRIMARY KEY,
        business_partner_id INT NOT NULL UNIQUE,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_customers_business_partner FOREIGN KEY (business_partner_id) REFERENCES business_partners(id),
        CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_customers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'employees')
    BEGIN
      CREATE TABLE employees (
        id INT IDENTITY(1,1) PRIMARY KEY,
        person_id INT NOT NULL UNIQUE,
        employee_code NVARCHAR(20) NOT NULL UNIQUE,
        cost_center_id INT NOT NULL,
        -- ObjectId de Mongo (coleccion positions) en formato string -cross-engine,
        -- sin FK real, misma convencion que product_id en purchase_request_lines.
        -- NULL a proposito: los colaboradores creados antes de este cambio no
        -- tienen cargo asignado retroactivamente.
        position_id NVARCHAR(24) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_employees_person FOREIGN KEY (person_id) REFERENCES persons(id),
        CONSTRAINT fk_employees_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_employees_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Guard manual (ver el de users.must_change_password mas arriba) para que
  // una base que ya tenia "employees" de antes de este cambio tambien termine
  // con la columna.
  await runDdl(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('employees') AND name = 'position_id'
    )
    BEGIN
      ALTER TABLE employees ADD position_id NVARCHAR(24) NULL;
    END
  `);

  // Depende de states (migrateGeography) y business_partners (arriba en
  // esta misma funcion) -por eso addresses no vive en migrateGeography,
  // pese a estar tematicamente ligada a la jerarquia geografica.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'addresses')
    BEGIN
      CREATE TABLE addresses (
        id INT IDENTITY(1,1) PRIMARY KEY,
        person_id INT NULL,
        business_partner_id INT NULL,
        address_type NVARCHAR(30) NOT NULL,
        address_line NVARCHAR(255) NOT NULL,
        state_id INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_addresses_person FOREIGN KEY (person_id) REFERENCES persons(id),
        CONSTRAINT fk_addresses_business_partner FOREIGN KEY (business_partner_id) REFERENCES business_partners(id),
        CONSTRAINT fk_addresses_state FOREIGN KEY (state_id) REFERENCES states(id),
        CONSTRAINT chk_addresses_owner CHECK (
          (person_id IS NOT NULL AND business_partner_id IS NULL) OR
          (person_id IS NULL AND business_partner_id IS NOT NULL)
        ),
        CONSTRAINT fk_addresses_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_addresses_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Va aca (no en migrateGeography, junto al de ux_cities_iata_codes) porque
  // el remapeo de FKs necesita que addresses ya exista -en una base nueva,
  // migrateGeography corre antes de que esta funcion cree la tabla de arriba.
  // Mismo hallazgo/razonamiento que el comentario de ux_cities_iata_codes:
  // states.territorial_code tampoco tenia UNIQUE, y por la misma condicion de
  // carrera entre las 3 replicas de la API terminaba duplicando la tabla
  // completa. El UPDATE+DELETE reasigna addresses.state_id que ya hubiera
  // quedado apuntando a una copia, hacia la fila mas antigua (MIN(id)), antes
  // de borrar las copias -corre una sola vez, dentro del mismo guard IF NOT
  // EXISTS que crea el indice.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_states_territorial_code' AND object_id = OBJECT_ID('states'))
    BEGIN
      ;WITH keep AS (
        SELECT territorial_code, MIN(id) AS keep_id
        FROM states
        WHERE territorial_code IS NOT NULL
        GROUP BY territorial_code
      )
      UPDATE a
      SET a.state_id = keep.keep_id
      FROM addresses a
      JOIN states dup ON dup.id = a.state_id
      JOIN keep ON keep.territorial_code = dup.territorial_code
      WHERE dup.id <> keep.keep_id;

      ;WITH keep AS (
        SELECT territorial_code, MIN(id) AS keep_id
        FROM states
        WHERE territorial_code IS NOT NULL
        GROUP BY territorial_code
      )
      DELETE s
      FROM states s
      JOIN keep ON keep.territorial_code = s.territorial_code
      WHERE s.id <> keep.keep_id;

      CREATE UNIQUE INDEX ux_states_territorial_code ON states(territorial_code) WHERE territorial_code IS NOT NULL;
    END
  `);
}

// Cadena PurchaseRequest -> PurchaseRequestLine -> Quote -> Authorization ->
// PurchaseOrder -> GoodsReceipt, toda en MSSQL con FK reales (ver memoria
// project-erp-scope-and-data-classification: cabecera+detalle no se
// reparten entre motores para no perder atomicidad/integridad referencial
// justo en el punto de reconciliacion mas sensible). product_id queda como
// NVARCHAR(24) -un ObjectId de Mongo, referencia cross-engine sin FK real,
// validada en la capa de servicio-.
async function migratePurchasingFlow(): Promise<void> {
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_requests')
    BEGIN
      CREATE TABLE purchase_requests (
        id INT IDENTITY(1,1) PRIMARY KEY,
        request_number NVARCHAR(20) NOT NULL UNIQUE,
        requester_id INT NOT NULL,
        requester_position NVARCHAR(100) NULL,
        requester_email NVARCHAR(150) NULL,
        requester_phone NVARCHAR(30) NULL,
        beneficiary_id INT NOT NULL,
        beneficiary_phone NVARCHAR(30) NULL,
        beneficiary_user_id INT NULL,
        cost_center_id INT NOT NULL,
        notes NVARCHAR(500) NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        priority NVARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
        -- Quien debe revisar/aprobar la solicitud, elegido al crearla (ver
        -- purchaseRequest.service.ts createPurchaseRequest: solo se acepta un
        -- usuario cuyo rol tenga el permiso purchase-requests:approve).
        -- Distinto de authorizations.approver_id (mas abajo): ese registra
        -- quien aprobo una linea/cotizacion puntual ya con precio, en una
        -- etapa posterior del flujo -esto es el aprobador ASIGNADO desde el
        -- inicio, antes de que exista ninguna cotizacion.
        approver_id INT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_purchase_requests_requester FOREIGN KEY (requester_id) REFERENCES persons(id),
        CONSTRAINT fk_purchase_requests_beneficiary FOREIGN KEY (beneficiary_id) REFERENCES persons(id),
        CONSTRAINT fk_purchase_requests_beneficiary_user FOREIGN KEY (beneficiary_user_id) REFERENCES users(id),
        CONSTRAINT fk_purchase_requests_approver FOREIGN KEY (approver_id) REFERENCES users(id),
        CONSTRAINT fk_purchase_requests_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_purchase_requests_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // MSSQL no soporta "ADD COLUMN IF NOT EXISTS": guard manual para que una
  // base creada antes de este cambio tambien termine con la columna (y su
  // FK), sin chocar contra el CREATE TABLE de arriba en instalaciones nuevas.
  await runDdl(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_requests') AND name = 'approver_id'
    )
    BEGIN
      ALTER TABLE purchase_requests ADD approver_id INT NULL;
      ALTER TABLE purchase_requests ADD CONSTRAINT fk_purchase_requests_approver
        FOREIGN KEY (approver_id) REFERENCES users(id);
    END
  `);

  // Filtrada directo en listPurchaseRequestsForApprover (purchaseRequest.
  // service.ts, "mis solicitudes por aprobar") -sin indice propio en MSSQL
  // para una FK, mismo criterio que ix_quotes_request_id mas abajo.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_purchase_requests_approver_id' AND object_id = OBJECT_ID('purchase_requests'))
    BEGIN
      CREATE INDEX ix_purchase_requests_approver_id ON purchase_requests(approver_id);
    END
  `);

  // Fase A: filtro server-side por status (RequestQuotation.tsx, UploadQuotes.tsx,
  // AproveRequest.tsx, etc. -ver purchaseRequestService.list({status:...})).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_purchase_requests_status' AND object_id = OBJECT_ID('purchase_requests'))
    BEGIN
      CREATE INDEX ix_purchase_requests_status ON purchase_requests(status);
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_request_lines')
    BEGIN
      CREATE TABLE purchase_request_lines (
        id INT IDENTITY(1,1) PRIMARY KEY,
        request_id INT NOT NULL,
        equipment_type NVARCHAR(100) NULL,
        product_id NVARCHAR(24) NOT NULL,
        supplier_id INT NULL,
        quantity INT NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_purchase_request_lines_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id),
        CONSTRAINT fk_purchase_request_lines_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT fk_purchase_request_lines_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_purchase_request_lines_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'quotes')
    BEGIN
      CREATE TABLE quotes (
        id INT IDENTITY(1,1) PRIMARY KEY,
        quote_number NVARCHAR(20) NOT NULL UNIQUE,
        request_id INT NOT NULL,
        product_id NVARCHAR(24) NOT NULL,
        supplier_id INT NOT NULL,
        purchase_value DECIMAL(18,2) NOT NULL,
        purchase_unit NVARCHAR(20) NULL,
        storage_unit NVARCHAR(20) NULL,
        product_code NVARCHAR(50) NULL,
        model NVARCHAR(100) NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_quotes_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id),
        CONSTRAINT fk_quotes_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT chk_quotes_status CHECK (status IN ('PENDING','SELECTED','REJECTED')),
        CONSTRAINT fk_quotes_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_quotes_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'authorizations')
    BEGIN
      CREATE TABLE authorizations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        request_line_id INT NOT NULL,
        quote_id INT NOT NULL,
        approved_at DATETIME2 NULL,
        approver_id INT NOT NULL,
        approved_quantity INT NOT NULL,
        product_id NVARCHAR(24) NOT NULL,
        supplier_id INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_authorizations_request_line FOREIGN KEY (request_line_id) REFERENCES purchase_request_lines(id),
        CONSTRAINT fk_authorizations_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
        CONSTRAINT fk_authorizations_approver FOREIGN KEY (approver_id) REFERENCES users(id),
        CONSTRAINT fk_authorizations_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT fk_authorizations_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_authorizations_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_orders')
    BEGIN
      CREATE TABLE purchase_orders (
        id INT IDENTITY(1,1) PRIMARY KEY,
        order_number NVARCHAR(20) NOT NULL UNIQUE,
        request_id INT NOT NULL,
        issued_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        payment_terms NVARCHAR(50) NULL,
        supplier_id INT NOT NULL,
        sent_at DATETIME2 NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_purchase_orders_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id),
        CONSTRAINT fk_purchase_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT fk_purchase_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_purchase_orders_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // sent_at: cuando la OC efectivamente salio por correo al proveedor (paso
  // 7) -distinto de issued_at (cuando se emitio/adjunto, paso 6). Guard
  // manual contra sys.columns, mismo patron que must_change_password arriba,
  // para instalaciones que ya tenian la tabla antes de este cambio.
  await runDdl(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'sent_at'
    )
    BEGIN
      ALTER TABLE purchase_orders ADD sent_at DATETIME2 NULL;
    END
  `);

  // Retrofit multi-cotizacion: una OC pasa a cubrir VARIAS cotizaciones
  // ganadoras del mismo proveedor dentro de la MISMA solicitud (antes 1:1 via
  // quote_id) -asi que la solicitud deja de deducirse via la cotizacion y se
  // guarda directo en la orden. 7 bloques guardados por ESTADO OBSERVABLE (no
  // por version): en instalacion limpia el CREATE de arriba ya deja la forma
  // final y los 7 quedan no-op; en una base que ya tenia quote_id, cada uno
  // hace su parte y se auto-desactiva en el proximo arranque. No se confia en
  // que runDdl()/isDuplicateMssqlObjectError se trague un choque de ADD/DROP
  // COLUMN -esa funcion (ver library/errors.ts) solo cubre 2714/2627/1913, NO
  // el 2705 (columna duplicada) ni el 4924 (drop de columna inexistente) que
  // tirarian ADD/DROP COLUMN si dos replicas los corrieran a la vez sin este
  // guard fino.

  // Bloque 1: agregar la columna nueva, nullable (no se puede agregar NOT
  // NULL sin default a una tabla con filas).
  await runDdl(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'request_id'
    )
    BEGIN
      ALTER TABLE purchase_orders ADD request_id INT NULL;
    END
  `);

  // Bloque 2: backfill desde el quote_id viejo. Re-ejecutable (WHERE
  // request_id IS NULL): la segunda corrida y las otras 2 replicas no tocan
  // ninguna fila. No-op en instalacion limpia (ahi quote_id ya no existe).
  // EXEC(N'...'): la resolucion diferida de nombres de SQL Server solo cubre
  // TABLAS inexistentes, no columnas -un UPDATE que referencia po.quote_id
  // falla en tiempo de COMPILACION del batch si la columna no existe en la
  // tabla real, aunque el IF que lo envuelve de arriba sea falso en runtime
  // (confirmado con "Invalid column name 'quote_id'" en una instalacion
  // limpia). Con EXEC() el texto se compila recien cuando el IF es true.
  await runDdl(`
    IF EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'quote_id'
    )
    BEGIN
      EXEC(N'
        UPDATE po
        SET po.request_id = q.request_id
        FROM purchase_orders po
        JOIN quotes q ON q.id = po.quote_id
        WHERE po.request_id IS NULL;
      ');
    END
  `);

  // Bloque 3: tabla puente N:M orden<->cotizacion (compartida por instalacion
  // limpia y retrofit). El UNIQUE sobre quote_id es lo que impide, a nivel de
  // MOTOR, que dos OC cubran la misma cotizacion -el findOne({where:{quoteId}})
  // que hacia ese guard en purchaseOrder.service.ts no era atomico con 3
  // replicas corriendo, misma leccion que ux_cities_iata_codes/
  // ux_states_territorial_code mas arriba en este archivo.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_order_quotes')
    BEGIN
      CREATE TABLE purchase_order_quotes (
        id INT IDENTITY(1,1) PRIMARY KEY,
        purchase_order_id INT NOT NULL,
        quote_id INT NOT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_purchase_order_quotes_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
        CONSTRAINT fk_purchase_order_quotes_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
        CONSTRAINT uq_purchase_order_quotes_quote UNIQUE (quote_id)
      );
    END
  `);

  // Bloque 4: backfill de una fila puente por cada OC vieja (1 quote_id -> 1
  // fila). Idempotente por NOT EXISTS; si dos replicas insertaran a la vez,
  // la perdedora choca contra uq_purchase_order_quotes_quote (2627) y
  // runDdl() se lo traga -"la otra ya lo dejo en el estado correcto".
  // EXEC(N'...'): mismo motivo que el bloque 2 -po.quote_id no compila si la
  // columna no existe en la tabla real, IF envolvente aparte.
  await runDdl(`
    IF EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'quote_id'
    )
    BEGIN
      EXEC(N'
        INSERT INTO purchase_order_quotes (purchase_order_id, quote_id)
        SELECT po.id, po.quote_id
        FROM purchase_orders po
        WHERE po.quote_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM purchase_order_quotes poq WHERE poq.quote_id = po.quote_id
          );
      ');
    END
  `);

  // Bloque 5: recien endurece a NOT NULL cuando ya no queda ninguna fila sin
  // backfillear.
  await runDdl(`
    IF EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'request_id' AND is_nullable = 1
    )
    AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE request_id IS NULL)
    BEGIN
      ALTER TABLE purchase_orders ALTER COLUMN request_id INT NOT NULL;
    END
  `);

  // Bloque 6: agrega la FK por nombre (no-op en instalacion limpia, ya existe
  // con este mismo nombre desde el CREATE TABLE de arriba).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_purchase_orders_request')
    BEGIN
      ALTER TABLE purchase_orders
        ADD CONSTRAINT fk_purchase_orders_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id);
    END
  `);

  // Bloque 7: punto de no retorno -solo dropea quote_id cuando (a) ninguna OC
  // quedo sin request_id y (b) ninguna OC quedo sin al menos una fila puente.
  // Si el backfill de arriba todavia no alcanzo a correr en esta replica,
  // esto simplemente no entra y se reintenta en el proximo arranque.
  await runDdl(`
    IF EXISTS (
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'quote_id'
    )
    AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE request_id IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM purchase_orders po
      WHERE NOT EXISTS (SELECT 1 FROM purchase_order_quotes poq WHERE poq.purchase_order_id = po.id)
    )
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_purchase_orders_quote')
        ALTER TABLE purchase_orders DROP CONSTRAINT fk_purchase_orders_quote;

      -- EXEC(): mismo motivo que los bloques 2 y 4 -por las dudas de que
      -- DROP COLUMN tambien valide el nombre en tiempo de compilacion.
      IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('purchase_orders') AND name = 'quote_id'
      )
        EXEC(N'ALTER TABLE purchase_orders DROP COLUMN quote_id;');
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_purchase_orders_request_id' AND object_id = OBJECT_ID('purchase_orders'))
    BEGIN
      CREATE INDEX ix_purchase_orders_request_id ON purchase_orders(request_id);
    END
  `);

  // quote_id ya queda indexado por uq_purchase_order_quotes_quote; el lado
  // purchase_order_id es el que se recorre al armar order.quotes.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_purchase_order_quotes_order_id' AND object_id = OBJECT_ID('purchase_order_quotes'))
    BEGIN
      CREATE INDEX ix_purchase_order_quotes_order_id ON purchase_order_quotes(purchase_order_id);
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'goods_receipts')
    BEGIN
      CREATE TABLE goods_receipts (
        id INT IDENTITY(1,1) PRIMARY KEY,
        document_type NVARCHAR(30) NOT NULL,
        document_number NVARCHAR(50) NOT NULL,
        purchase_order_id INT NOT NULL,
        quote_id INT NOT NULL,
        request_id INT NOT NULL,
        product_id NVARCHAR(24) NOT NULL,
        supplier_id INT NOT NULL,
        purchase_value DECIMAL(18,2) NOT NULL,
        received_quantity INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_goods_receipts_purchase_order FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
        CONSTRAINT fk_goods_receipts_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
        CONSTRAINT fk_goods_receipts_request FOREIGN KEY (request_id) REFERENCES purchase_requests(id),
        CONSTRAINT fk_goods_receipts_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT chk_goods_receipts_document_type CHECK (document_type IN ('GUIA_DESPACHO','BOLETA','FACTURA')),
        CONSTRAINT fk_goods_receipts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_goods_receipts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // FKs sin indice propio, filtradas directo en listX ByY (quote.service.ts,
  // authorization.service.ts, goodsReceipt.service.ts) -SQL Server no indexa
  // automaticamente una FK, solo la PK.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_quotes_request_id' AND object_id = OBJECT_ID('quotes'))
    BEGIN
      CREATE INDEX ix_quotes_request_id ON quotes(request_id);
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_authorizations_request_line_id' AND object_id = OBJECT_ID('authorizations'))
    BEGIN
      CREATE INDEX ix_authorizations_request_line_id ON authorizations(request_line_id);
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_goods_receipts_purchase_order_id' AND object_id = OBJECT_ID('goods_receipts'))
    BEGIN
      CREATE INDEX ix_goods_receipts_purchase_order_id ON goods_receipts(purchase_order_id);
    END
  `);
  // Evita recepcionar dos veces el mismo documento del proveedor (guia/
  // boleta/factura) contra la misma orden -sin esto, nada impedia duplicar
  // una recepcion mientras la cantidad total siguiera bajo lo autorizado
  // (hallazgo de auditoria de seguridad, relacionado con la condicion de
  // carrera de createGoodsReceipt). document_number es texto libre del
  // proveedor, por eso la unicidad es compuesta con purchase_order_id +
  // document_type, no solo el numero.
  //
  // quote_id entra a la clave (indice con NOMBRE NUEVO, no se reusa
  // ux_goods_receipts_order_document con otra definicion -el guard
  // IF NOT EXISTS(name=...) nunca detectaria el cambio en una base ya
  // migrada): con una OC multi-cotizacion, dos productos distintos de la
  // MISMA orden pueden llegar en la misma guia/factura fisica, y sin
  // quote_id en la clave la segunda recepcion chocaria contra la primera
  // para siempre.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_goods_receipts_order_quote_document' AND object_id = OBJECT_ID('goods_receipts'))
    BEGIN
      IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_goods_receipts_order_document' AND object_id = OBJECT_ID('goods_receipts'))
        DROP INDEX ux_goods_receipts_order_document ON goods_receipts;

      CREATE UNIQUE INDEX ux_goods_receipts_order_quote_document
        ON goods_receipts(purchase_order_id, quote_id, document_type, document_number);
    END
  `);
}
