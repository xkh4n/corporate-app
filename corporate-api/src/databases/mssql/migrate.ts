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
  await migratePrevisional();
  await migratePayroll();
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

  // Identidad exigida por Previred (campos 3, 4, 6 y 7 del formato): apellido
  // materno, sexo y nacionalidad. last_name pasa a leerse como apellido
  // PATERNO en los alta nuevos. NULL a proposito: las personas ya existentes
  // (usuarios, solicitantes, admin bootstrap) no los tienen y no hay forma de
  // inferirlos -de hecho last_name de esas filas puede traer ambos apellidos
  // juntos-; el generador de la nomina rechaza a un colaborador que los tenga
  // vacios. Un batch por sentencia: SQL Server valida las columnas de una
  // tabla existente al compilar el batch, asi que un ADD COLUMN y un ADD
  // CONSTRAINT que la referencia no pueden ir juntos.
  for (const [column, ddl] of [
    ["maternal_last_name", "NVARCHAR(100) NULL"],
    ["sex", "NVARCHAR(1) NULL"],
    ["nationality", "SMALLINT NULL"],
  ] as const) {
    await runDdl(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('persons') AND name = '${column}'
      )
      BEGIN
        ALTER TABLE persons ADD ${column} ${ddl};
      END
    `);
  }
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_persons_sex')
    BEGIN
      ALTER TABLE persons ADD CONSTRAINT chk_persons_sex CHECK (sex IS NULL OR sex IN ('M','F'));
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_persons_nationality')
    BEGIN
      ALTER TABLE persons ADD CONSTRAINT chk_persons_nationality CHECK (nationality IS NULL OR nationality IN (0,1));
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

  await migrateMfa();
}

// Plan 017: segundo factor. El secreto TOTP va cifrado (library/mfa/secretBox.ts), los codigos de
// recuperacion como HMAC con clave propia (nunca en claro) y las passkeys solo guardan la clave
// publica. "Enrolado" = al menos un factor activo; mfa_enrolled_at marca cuando paso por primera vez.
async function migrateMfa(): Promise<void> {
  for (const [column, definition] of [
    ["mfa_totp_secret_enc", "NVARCHAR(255) NULL"],
    ["mfa_email_enabled", "BIT NOT NULL DEFAULT 0"],
    ["mfa_enrolled_at", "DATETIME2 NULL"],
  ] as const) {
    await runDdl(`
      IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('users') AND name = '${column}'
      )
      BEGIN
        ALTER TABLE users ADD ${column} ${definition};
      END
    `);
  }

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_webauthn_credentials')
    BEGIN
      CREATE TABLE user_webauthn_credentials (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        credential_id NVARCHAR(512) NOT NULL,
        public_key VARBINARY(MAX) NOT NULL,
        sign_count BIGINT NOT NULL DEFAULT 0,
        transports NVARCHAR(100) NULL,
        device_name NVARCHAR(100) NOT NULL,
        aaguid NVARCHAR(36) NULL,
        backed_up BIT NOT NULL DEFAULT 0,
        last_used_at DATETIME2 NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_user_webauthn_credentials_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT uq_user_webauthn_credentials_credential UNIQUE (credential_id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_user_webauthn_credentials_user_id' AND object_id = OBJECT_ID('user_webauthn_credentials'))
    BEGIN
      CREATE INDEX ix_user_webauthn_credentials_user_id ON user_webauthn_credentials(user_id);
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'user_mfa_recovery_codes')
    BEGIN
      CREATE TABLE user_mfa_recovery_codes (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        code_hash NVARCHAR(64) NOT NULL,
        used_at DATETIME2 NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_user_mfa_recovery_codes_user FOREIGN KEY (user_id) REFERENCES users(id)
      );
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_user_mfa_recovery_codes_user_hash' AND object_id = OBJECT_ID('user_mfa_recovery_codes'))
    BEGIN
      CREATE INDEX ix_user_mfa_recovery_codes_user_hash ON user_mfa_recovery_codes(user_id, code_hash);
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

  // UNIQUE sobre request_line_id: mismo motivo y mismo patron que
  // uq_purchase_order_quotes_quote mas abajo en este archivo -el chequeo
  // "la linea ya tiene Authorization" en authorization.service.ts no es
  // atomico con 2+ replicas/llamadas concurrentes del aprobador asignado.
  // El guard NOT EXISTS de duplicados hace que el ALTER sea no-op (en vez
  // de fallar) si una instalacion ya arrastraba dos Authorization para la
  // misma linea antes de este fix -se reintenta en el proximo arranque una
  // vez que esos datos se reconcilien a mano.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'uq_authorizations_request_line')
    AND NOT EXISTS (
      SELECT request_line_id FROM authorizations GROUP BY request_line_id HAVING COUNT(*) > 1
    )
    BEGIN
      ALTER TABLE authorizations ADD CONSTRAINT uq_authorizations_request_line UNIQUE (request_line_id);
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


// Cotizaciones previsionales para la nomina Previred (formato estandar de
// largo variable, 105 campos). Depende de employees (migrateBusinessPartners)
// y de users (created_by), por eso va despues de ambas. Orden interno:
// catalogos -> tasas -> config empleador -> perfil por trabajador -> planilla
// -> lineas, que es el orden de las FK.
async function migratePrevisional(): Promise<void> {
  // Catalogo unico AFP/SALUD/CCAF/MUTUAL/CESANTIA. El CHECK cierra los 5 tipos
  // porque cada uno tiene su propia Tabla de Equivalencia en Previred.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'previsional_institutions')
    BEGIN
      CREATE TABLE previsional_institutions (
        id INT IDENTITY(1,1) PRIMARY KEY,
        type NVARCHAR(20) NOT NULL,
        code NVARCHAR(30) NOT NULL UNIQUE,
        name NVARCHAR(150) NOT NULL,
        national_id NVARCHAR(20) NULL,
        previred_code NVARCHAR(4) NULL,
        address NVARCHAR(255) NULL,
        phone NVARCHAR(30) NULL,
        legal_representative NVARCHAR(150) NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT chk_previsional_institutions_type CHECK (type IN ('AFP','SALUD','CCAF','MUTUAL','CESANTIA')),
        CONSTRAINT fk_previsional_institutions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_previsional_institutions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Los codigos Previred se repiten entre tipos (01 = Banmedica, Los Andes y
  // ACHS), asi que la unicidad es por (type, previred_code). Filtrado porque
  // AFC no tiene codigo.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_previsional_institutions_type_code' AND object_id = OBJECT_ID('previsional_institutions'))
    BEGIN
      CREATE UNIQUE INDEX ux_previsional_institutions_type_code
        ON previsional_institutions(type, previred_code) WHERE previred_code IS NOT NULL;
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_previsional_institutions_national_id' AND object_id = OBJECT_ID('previsional_institutions'))
    BEGIN
      CREATE UNIQUE INDEX ux_previsional_institutions_national_id
        ON previsional_institutions(national_id) WHERE national_id IS NOT NULL;
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'apv_institutions')
    BEGIN
      CREATE TABLE apv_institutions (
        id INT IDENTITY(1,1) PRIMARY KEY,
        previred_code NVARCHAR(3) NOT NULL UNIQUE,
        name NVARCHAR(150) NOT NULL,
        institution_group NVARCHAR(20) NOT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT chk_apv_institutions_group CHECK (institution_group IN ('AFP','SEGUROS_VIDA','FONDOS_MUTUOS','CORREDORES_BOLSA')),
        CONSTRAINT fk_apv_institutions_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_apv_institutions_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // rate_type sin CHECK a proposito: los tipos de tasa crecen con cada reforma
  // previsional (expectativa de vida y rentabilidad protegida son recientes) y
  // con el guard IF NOT EXISTS de este archivo un CHECK ya creado no se puede
  // ampliar sin migracion manual. La lista vive en previsionalRate.model.ts.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'previsional_rates')
    BEGIN
      CREATE TABLE previsional_rates (
        id INT IDENTITY(1,1) PRIMARY KEY,
        rate_type NVARCHAR(30) NOT NULL,
        institution_id INT NULL,
        rate DECIMAL(7,4) NOT NULL,
        valid_from DATE NOT NULL,
        valid_to DATE NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_previsional_rates_institution FOREIGN KEY (institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT chk_previsional_rates_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
        CONSTRAINT chk_previsional_rates_rate CHECK (rate >= 0 AND rate <= 100),
        CONSTRAINT fk_previsional_rates_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_previsional_rates_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);
  // institution_id NULL (tasa global) cuenta como un valor mas en un indice
  // unico de SQL Server, asi que dos tasas globales del mismo tipo y misma
  // fecha de inicio tambien chocan -que es lo que se quiere.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_previsional_rates_type_inst_from' AND object_id = OBJECT_ID('previsional_rates'))
    BEGIN
      CREATE UNIQUE INDEX ux_previsional_rates_type_inst_from
        ON previsional_rates(rate_type, institution_id, valid_from);
    END
  `);

  // Fila unica del empleador: id sin IDENTITY, DEFAULT 1 y CHECK (id = 1).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'previred_employer_settings')
    BEGIN
      CREATE TABLE previred_employer_settings (
        id INT NOT NULL PRIMARY KEY DEFAULT 1,
        ccaf_institution_id INT NULL,
        mutual_institution_id INT NULL,
        mutual_branch_code INT NULL,
        work_accident_rate DECIMAL(7,4) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT chk_previred_employer_settings_single CHECK (id = 1),
        CONSTRAINT fk_previred_employer_settings_ccaf FOREIGN KEY (ccaf_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_employer_settings_mutual FOREIGN KEY (mutual_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_employer_settings_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_previred_employer_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Regimen, tipo de trabajador y contrato son NULL hasta que se asignen: el
  // perfil nace cuando se asigna la primera pieza (AFP o salud), sea cual sea,
  // y una fila a medio llenar es un estado valido. Un CHECK sobre NULL no
  // rechaza (evalua UNKNOWN), asi que los de abajo solo actuan cuando hay
  // valor; que el perfil este COMPLETO lo exige el generador de la nomina.
  // Los CHECK espejan las Tablas de Equivalencia de Previred (4, 5, 8, 17,
  // 22) y los topes de cargas del validador (simples <= 13, maternales <= 1,
  // invalidas <= 1). "regime = AFP exige AFP" evita un perfil que Previred
  // rechazaria (campo 26 obligatorio si esta en AFP). Que afp_institution_id
  // apunte a una institucion de tipo AFP (y health_ a SALUD) no se puede
  // expresar como FK: lo valida la capa de servicio.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'employee_previsional_profiles')
    BEGIN
      CREATE TABLE employee_previsional_profiles (
        id INT IDENTITY(1,1) PRIMARY KEY,
        employee_id INT NOT NULL UNIQUE,
        regime NVARCHAR(3) NULL,
        worker_type SMALLINT NULL,
        afp_institution_id INT NULL,
        health_institution_id INT NULL,
        health_fun NVARCHAR(16) NULL,
        health_plan_currency SMALLINT NULL,
        health_agreed_amount DECIMAL(12,4) NULL,
        afc_covered BIT NOT NULL DEFAULT 1,
        family_allowance_bracket NVARCHAR(1) NOT NULL DEFAULT 'D',
        simple_charges SMALLINT NOT NULL DEFAULT 0,
        maternal_charges SMALLINT NOT NULL DEFAULT 0,
        disabled_charges SMALLINT NOT NULL DEFAULT 0,
        workday_type SMALLINT NOT NULL DEFAULT 1,
        heavy_work_position NVARCHAR(40) NULL,
        heavy_work_rate DECIMAL(5,2) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_employee_previsional_profiles_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
        CONSTRAINT fk_employee_previsional_profiles_afp FOREIGN KEY (afp_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_employee_previsional_profiles_health FOREIGN KEY (health_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT chk_employee_previsional_profiles_regime CHECK (regime IN ('AFP','INP','SIP')),
        CONSTRAINT chk_employee_previsional_profiles_worker_type CHECK (worker_type IN (0,1,2,3,8,9)),
        CONSTRAINT chk_employee_previsional_profiles_afp_required CHECK (regime <> 'AFP' OR afp_institution_id IS NOT NULL),
        CONSTRAINT chk_employee_previsional_profiles_currency CHECK (health_plan_currency IS NULL OR health_plan_currency IN (1,2)),
        CONSTRAINT chk_employee_previsional_profiles_bracket CHECK (family_allowance_bracket IN ('A','B','C','D')),
        CONSTRAINT chk_employee_previsional_profiles_charges CHECK (
          simple_charges BETWEEN 0 AND 13 AND maternal_charges BETWEEN 0 AND 1 AND disabled_charges BETWEEN 0 AND 1
        ),
        CONSTRAINT chk_employee_previsional_profiles_workday CHECK (workday_type IN (1,2)),
        CONSTRAINT chk_employee_previsional_profiles_heavy_rate CHECK (heavy_work_rate IS NULL OR heavy_work_rate IN (2,4)),
        CONSTRAINT fk_employee_previsional_profiles_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_employee_previsional_profiles_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Camino de actualizacion: la primera version de esta tabla (ya aplicada en
  // dev) tenia apellidos/sexo/nacionalidad aca y regimen/contrato NOT NULL.
  // Esos datos de identidad ahora viven en persons (ver migrateAuth). La tabla
  // estaba vacia al moverlos, asi que borrar las columnas no pierde datos.
  for (const constraint of ["chk_employee_previsional_profiles_sex", "chk_employee_previsional_profiles_nationality"]) {
    await runDdl(`
      IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = '${constraint}')
      BEGIN
        ALTER TABLE employee_previsional_profiles DROP CONSTRAINT ${constraint};
      END
    `);
  }
  for (const column of ["paternal_surname", "maternal_surname", "sex", "nationality"]) {
    await runDdl(`
      IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('employee_previsional_profiles') AND name = '${column}'
      )
      BEGIN
        ALTER TABLE employee_previsional_profiles DROP COLUMN ${column};
      END
    `);
  }
  for (const [column, ddl] of [
    ["regime", "NVARCHAR(3) NULL"],
    ["worker_type", "SMALLINT NULL"],
  ] as const) {
    await runDdl(`
      IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('employee_previsional_profiles') AND name = '${column}' AND is_nullable = 0
      )
      BEGIN
        ALTER TABLE employee_previsional_profiles ALTER COLUMN ${column} ${ddl};
      END
    `);
  }

  // Tipo de contrato y fecha de inicio pasaron a employee_contracts (migratePayroll).
  // El CHECK va primero: SQL Server no deja borrar una columna referenciada.
  await runDdl(`
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_employee_previsional_profiles_contract')
    BEGIN
      ALTER TABLE employee_previsional_profiles DROP CONSTRAINT chk_employee_previsional_profiles_contract;
    END
  `);
  for (const column of ["contract_type", "contract_start_date"]) {
    await runDdl(`
      IF EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('employee_previsional_profiles') AND name = '${column}'
      )
      BEGIN
        ALTER TABLE employee_previsional_profiles DROP COLUMN ${column};
      END
    `);
  }

  // period_from siempre dia 1 (Previred trabaja por mes, formato mmaaaa) y
  // period_to obligatorio en gratificaciones/bono (tipos 02 y 03).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'previred_payrolls')
    BEGIN
      CREATE TABLE previred_payrolls (
        id INT IDENTITY(1,1) PRIMARY KEY,
        payment_type NVARCHAR(2) NOT NULL,
        period_from DATE NOT NULL,
        period_to DATE NULL,
        status NVARCHAR(15) NOT NULL DEFAULT 'DRAFT',
        generated_at DATETIME2 NULL,
        generated_by INT NULL,
        file_name NVARCHAR(150) NULL,
        file_sha256 NVARCHAR(64) NULL,
        notes NVARCHAR(500) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT chk_previred_payrolls_payment_type CHECK (payment_type IN ('01','02','03')),
        CONSTRAINT chk_previred_payrolls_status CHECK (status IN ('DRAFT','VALIDATED','GENERATED','SUBMITTED')),
        CONSTRAINT chk_previred_payrolls_period_from CHECK (DAY(period_from) = 1),
        CONSTRAINT chk_previred_payrolls_period_to CHECK (
          (period_to IS NULL OR (DAY(period_to) = 1 AND period_to >= period_from))
          AND (payment_type = '01' OR period_to IS NOT NULL)
        ),
        CONSTRAINT fk_previred_payrolls_generated_by FOREIGN KEY (generated_by) REFERENCES users(id),
        CONSTRAINT fk_previred_payrolls_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_previred_payrolls_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);
  // period_to NULL cuenta como valor en el indice unico: una sola nomina 01 por
  // periodo, y una sola 02/03 por (periodo desde, periodo hasta).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_previred_payrolls_type_period' AND object_id = OBJECT_ID('previred_payrolls'))
    BEGIN
      CREATE UNIQUE INDEX ux_previred_payrolls_type_period
        ON previred_payrolls(payment_type, period_from, period_to);
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'previred_payroll_lines')
    BEGIN
      CREATE TABLE previred_payroll_lines (
        id INT IDENTITY(1,1) PRIMARY KEY,
        payroll_id INT NOT NULL,
        employee_id INT NOT NULL,
        line_type NVARCHAR(2) NOT NULL DEFAULT '00',
        line_seq SMALLINT NOT NULL DEFAULT 0,

        regime NVARCHAR(3) NOT NULL,
        worker_type SMALLINT NOT NULL,
        days_worked SMALLINT NOT NULL,
        movement_code SMALLINT NOT NULL DEFAULT 0,
        movement_from DATE NULL,
        movement_to DATE NULL,
        family_allowance_bracket NVARCHAR(1) NOT NULL DEFAULT 'D',
        simple_charges SMALLINT NOT NULL DEFAULT 0,
        maternal_charges SMALLINT NOT NULL DEFAULT 0,
        disabled_charges SMALLINT NOT NULL DEFAULT 0,
        family_allowance INT NOT NULL DEFAULT 0,
        retroactive_family_allowance INT NOT NULL DEFAULT 0,
        family_charges_refund INT NOT NULL DEFAULT 0,
        young_worker_subsidy NVARCHAR(1) NULL,

        afp_institution_id INT NULL,
        afp_taxable_income INT NOT NULL DEFAULT 0,
        afp_mandatory_contribution INT NOT NULL DEFAULT 0,
        sis_contribution INT NOT NULL DEFAULT 0,
        afp_voluntary_savings INT NOT NULL DEFAULT 0,
        substitute_taxable_income INT NOT NULL DEFAULT 0,
        substitute_agreed_rate DECIMAL(5,2) NULL,
        substitute_severance_contribution INT NOT NULL DEFAULT 0,
        substitute_periods SMALLINT NOT NULL DEFAULT 0,
        substitute_from DATE NULL,
        substitute_to DATE NULL,
        heavy_work_position NVARCHAR(40) NULL,
        heavy_work_rate DECIMAL(5,2) NULL,
        heavy_work_contribution INT NOT NULL DEFAULT 0,

        apvi_institution_id INT NULL,
        apvi_contract_number NVARCHAR(20) NULL,
        apvi_payment_method SMALLINT NULL,
        apvi_amount INT NOT NULL DEFAULT 0,
        apvi_agreed_deposits INT NOT NULL DEFAULT 0,
        apvc_institution_id INT NULL,
        apvc_contract_number NVARCHAR(20) NULL,
        apvc_payment_method SMALLINT NULL,
        apvc_worker_amount INT NOT NULL DEFAULT 0,
        apvc_employer_amount INT NOT NULL DEFAULT 0,

        ips_ex_fund_code NVARCHAR(4) NULL,
        ips_rate DECIMAL(5,2) NULL,
        ips_taxable_income INT NOT NULL DEFAULT 0,
        ips_mandatory_contribution INT NOT NULL DEFAULT 0,
        severance_taxable_income INT NOT NULL DEFAULT 0,
        severance_fund_code NVARCHAR(4) NULL,
        severance_rate DECIMAL(5,2) NULL,
        severance_contribution INT NOT NULL DEFAULT 0,
        fonasa_contribution INT NOT NULL DEFAULT 0,
        isl_work_accident_contribution INT NOT NULL DEFAULT 0,
        law_15386_bonus INT NOT NULL DEFAULT 0,
        ips_family_charges_discount INT NOT NULL DEFAULT 0,
        government_bonus INT NOT NULL DEFAULT 0,

        health_institution_id INT NULL,
        health_fun NVARCHAR(16) NULL,
        health_taxable_income INT NOT NULL DEFAULT 0,
        health_plan_currency SMALLINT NULL,
        health_agreed_contribution DECIMAL(12,4) NULL,
        health_mandatory_contribution INT NOT NULL DEFAULT 0,
        health_additional_contribution INT NOT NULL DEFAULT 0,
        ges_contribution INT NOT NULL DEFAULT 0,

        ccaf_institution_id INT NULL,
        ccaf_taxable_income INT NOT NULL DEFAULT 0,
        ccaf_personal_credits INT NOT NULL DEFAULT 0,
        ccaf_dental_discount INT NOT NULL DEFAULT 0,
        ccaf_leasing_discount INT NOT NULL DEFAULT 0,
        ccaf_life_insurance_discount INT NOT NULL DEFAULT 0,
        ccaf_other_discounts INT NOT NULL DEFAULT 0,
        ccaf_non_isapre_contribution INT NOT NULL DEFAULT 0,
        ccaf_family_charges_discount INT NOT NULL DEFAULT 0,

        previous_month_taxable_income INT NULL,
        workday_type SMALLINT NOT NULL DEFAULT 1,
        life_expectancy_contribution INT NOT NULL DEFAULT 0,
        protected_return_contribution INT NOT NULL DEFAULT 0,

        mutual_institution_id INT NULL,
        mutual_taxable_income INT NOT NULL DEFAULT 0,
        mutual_work_accident_contribution INT NOT NULL DEFAULT 0,
        mutual_branch_code INT NULL,

        afc_taxable_income INT NOT NULL DEFAULT 0,
        afc_worker_contribution INT NOT NULL DEFAULT 0,
        afc_employer_contribution INT NOT NULL DEFAULT 0,

        subsidy_payer_institution_id INT NULL,
        cost_center_label NVARCHAR(20) NULL,

        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT fk_previred_payroll_lines_payroll FOREIGN KEY (payroll_id) REFERENCES previred_payrolls(id),
        CONSTRAINT fk_previred_payroll_lines_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
        CONSTRAINT fk_previred_payroll_lines_afp FOREIGN KEY (afp_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_payroll_lines_health FOREIGN KEY (health_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_payroll_lines_ccaf FOREIGN KEY (ccaf_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_payroll_lines_mutual FOREIGN KEY (mutual_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_payroll_lines_subsidy_payer FOREIGN KEY (subsidy_payer_institution_id) REFERENCES previsional_institutions(id),
        CONSTRAINT fk_previred_payroll_lines_apvi FOREIGN KEY (apvi_institution_id) REFERENCES apv_institutions(id),
        CONSTRAINT fk_previred_payroll_lines_apvc FOREIGN KEY (apvc_institution_id) REFERENCES apv_institutions(id),
        CONSTRAINT chk_previred_payroll_lines_line_type CHECK (line_type IN ('00','01','02','03')),
        CONSTRAINT chk_previred_payroll_lines_days CHECK (days_worked BETWEEN 0 AND 30),
        CONSTRAINT chk_previred_payroll_lines_regime CHECK (regime IN ('AFP','INP','SIP')),
        CONSTRAINT chk_previred_payroll_lines_bracket CHECK (family_allowance_bracket IN ('A','B','C','D')),
        CONSTRAINT chk_previred_payroll_lines_workday CHECK (workday_type IN (1,2)),
        CONSTRAINT chk_previred_payroll_lines_young_subsidy CHECK (young_worker_subsidy IS NULL OR young_worker_subsidy IN ('S','N')),
        CONSTRAINT chk_previred_payroll_lines_apv_method CHECK (
          (apvi_payment_method IS NULL OR apvi_payment_method IN (1,2))
          AND (apvc_payment_method IS NULL OR apvc_payment_method IN (1,2))
        ),
        CONSTRAINT fk_previred_payroll_lines_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_previred_payroll_lines_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // Una linea por (nomina, trabajador, orden): payroll_id lidera el indice, asi
  // que cubre tambien el recorrido "todas las lineas de una nomina" al generar.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_previred_payroll_lines_payroll_employee_seq' AND object_id = OBJECT_ID('previred_payroll_lines'))
    BEGIN
      CREATE UNIQUE INDEX ux_previred_payroll_lines_payroll_employee_seq
        ON previred_payroll_lines(payroll_id, employee_id, line_seq);
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_previred_payroll_lines_employee_id' AND object_id = OBJECT_ID('previred_payroll_lines'))
    BEGIN
      CREATE INDEX ix_previred_payroll_lines_employee_id ON previred_payroll_lines(employee_id);
    END
  `);
}


// Remuneraciones: configuracion de la empresa, parametros monetarios, contrato
// del colaborador (sueldo base + forma de pago de la gratificacion legal) y los
// movimientos de gratificacion que alimentaran la liquidacion. Depende de
// employees y users, por eso va despues de migrateBusinessPartners.
async function migratePayroll(): Promise<void> {
  // Fila unica de la empresa: id sin IDENTITY, DEFAULT 1 y CHECK (id = 1).
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'payroll_settings')
    BEGIN
      CREATE TABLE payroll_settings (
        id INT NOT NULL PRIMARY KEY DEFAULT 1,
        gratification_system NVARCHAR(15) NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT chk_payroll_settings_single CHECK (id = 1),
        CONSTRAINT chk_payroll_settings_gratification CHECK (gratification_system IS NULL OR gratification_system IN ('ART47','ART50','CONVENCIONAL')),
        CONSTRAINT fk_payroll_settings_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_payroll_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  // % del sueldo base que la empresa anticipa cada mes; con el se calcula en
  // pesos el anticipo del contrato al crear el colaborador. Se agrego despues de
  // la primera version de la tabla, asi que va por ALTER (columna y CHECK en
  // batches separados). Que sea coherente con el sistema (ART47 no anticipa,
  // ART50 hasta 25%) lo valida el servicio, no la BD: son reglas legales.
  await runDdl(`
    IF COL_LENGTH('payroll_settings', 'gratification_monthly_advance_percentage') IS NULL
    BEGIN
      ALTER TABLE payroll_settings ADD gratification_monthly_advance_percentage DECIMAL(5,2) NULL;
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_payroll_settings_advance_pct')
    BEGIN
      ALTER TABLE payroll_settings ADD CONSTRAINT chk_payroll_settings_advance_pct CHECK (
        gratification_monthly_advance_percentage IS NULL
        OR (gratification_monthly_advance_percentage > 0 AND gratification_monthly_advance_percentage <= 100)
      );
    END
  `);

  // code sin CHECK (mismo criterio que previsional_rates.rate_type): la lista
  // de parametros crece y un CHECK ya creado no se amplia con estos guards.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'payroll_parameters')
    BEGIN
      CREATE TABLE payroll_parameters (
        id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        value DECIMAL(14,4) NOT NULL,
        valid_from DATE NOT NULL,
        valid_to DATE NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT chk_payroll_parameters_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
        CONSTRAINT chk_payroll_parameters_value CHECK (value > 0),
        CONSTRAINT fk_payroll_parameters_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_payroll_parameters_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_payroll_parameters_code_from' AND object_id = OBJECT_ID('payroll_parameters'))
    BEGIN
      CREATE UNIQUE INDEX ux_payroll_parameters_code_from ON payroll_parameters(code, valid_from);
    END
  `);

  // Los CHECK cruzados espejan reglas de negocio que no dependen de datos
  // externos: plazo fijo exige fecha de termino; mes de reliquidacion exigido
  // salvo en modo MENSUAL; reajuste por IPC solo tiene sentido con anticipos;
  // tope = tipo + factor juntos o ninguno. Las reglas por tipo de gratificacion
  // (ART50 = 25% y 4,75 IMM) las valida el servicio, no la BD, para poder
  // ajustarlas sin migrar. Un solo contrato ABIERTO (sin end_date) por
  // colaborador; el solape entre contratos con fecha de termino, en el servicio.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'employee_contracts')
    BEGIN
      CREATE TABLE employee_contracts (
        id INT IDENTITY(1,1) PRIMARY KEY,
        employee_id INT NOT NULL,
        contract_type NVARCHAR(15) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        base_salary INT NOT NULL,
        gratification_type NVARCHAR(15) NOT NULL,
        gratification_method NVARCHAR(30) NOT NULL,
        gratification_percentage DECIMAL(5,2) NOT NULL,
        gratification_cap_type NVARCHAR(10) NULL,
        gratification_cap_factor DECIMAL(6,3) NULL,
        gratification_payment_mode NVARCHAR(30) NOT NULL,
        gratification_settlement_month SMALLINT NULL,
        gratification_adjust_advances_cpi BIT NOT NULL DEFAULT 0,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_employee_contracts_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
        CONSTRAINT chk_employee_contracts_type CHECK (contract_type IN ('INDEFINIDO','PLAZO_FIJO')),
        CONSTRAINT chk_employee_contracts_dates CHECK (end_date IS NULL OR end_date >= start_date),
        CONSTRAINT chk_employee_contracts_fixed_term CHECK (contract_type <> 'PLAZO_FIJO' OR end_date IS NOT NULL),
        CONSTRAINT chk_employee_contracts_salary CHECK (base_salary > 0),
        CONSTRAINT chk_employee_contracts_grat_type CHECK (gratification_type IN ('ART47','ART50','CONVENCIONAL')),
        CONSTRAINT chk_employee_contracts_grat_method CHECK (gratification_method IN ('PORCENTAJE_REMUNERACIONES','PARTICIPACION_UTILIDADES')),
        CONSTRAINT chk_employee_contracts_grat_pct CHECK (gratification_percentage > 0 AND gratification_percentage <= 100),
        CONSTRAINT chk_employee_contracts_grat_cap_v2 CHECK (
          (gratification_cap_type IS NULL AND gratification_cap_factor IS NULL)
          OR (gratification_cap_type = 'IMM' AND gratification_cap_factor IS NOT NULL AND gratification_cap_factor > 0)
        ),
        CONSTRAINT chk_employee_contracts_grat_mode CHECK (gratification_payment_mode IN ('MENSUAL','ANTICIPO_MENSUAL_RELIQUIDACION','ANUAL')),
        CONSTRAINT chk_employee_contracts_grat_month_v2 CHECK (
          (gratification_payment_mode = 'MENSUAL' AND gratification_settlement_month IS NULL)
          OR (gratification_payment_mode <> 'MENSUAL' AND gratification_settlement_month IS NOT NULL
              AND gratification_settlement_month BETWEEN 1 AND 12)
        ),
        CONSTRAINT chk_employee_contracts_grat_cpi CHECK (
          gratification_adjust_advances_cpi = 0 OR gratification_payment_mode = 'ANTICIPO_MENSUAL_RELIQUIDACION'
        ),
        CONSTRAINT fk_employee_contracts_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_employee_contracts_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);
  // Camino de actualizacion: la primera version de estos dos CHECK (ya aplicada en
  // dev) dejaba pasar NULL. En SQL un CHECK que evalua a UNKNOWN NO rechaza, asi
  // que "modo ANTICIPO con mes NULL" y "tope IMM con factor NULL" se colaban:
  // faltaba exigir IS NOT NULL en la rama que compara. Se reemplazan con otro
  // nombre (_v2) porque el guard IF NOT EXISTS por nombre nunca detectaria un
  // cambio de definicion bajo el mismo nombre.
  for (const [oldName, newName, definition] of [
    [
      "chk_employee_contracts_grat_cap",
      "chk_employee_contracts_grat_cap_v2",
      `(gratification_cap_type IS NULL AND gratification_cap_factor IS NULL)
       OR (gratification_cap_type = 'IMM' AND gratification_cap_factor IS NOT NULL AND gratification_cap_factor > 0)`,
    ],
    [
      "chk_employee_contracts_grat_month",
      "chk_employee_contracts_grat_month_v2",
      `(gratification_payment_mode = 'MENSUAL' AND gratification_settlement_month IS NULL)
       OR (gratification_payment_mode <> 'MENSUAL' AND gratification_settlement_month IS NOT NULL
           AND gratification_settlement_month BETWEEN 1 AND 12)`,
    ],
  ] as const) {
    await runDdl(`
      IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = '${oldName}')
      BEGIN
        ALTER TABLE employee_contracts DROP CONSTRAINT ${oldName};
      END
    `);
    await runDdl(`
      IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = '${newName}')
      BEGIN
        ALTER TABLE employee_contracts ADD CONSTRAINT ${newName} CHECK (${definition});
      END
    `);
  }
  // Monto que se anticipa cada mes (pesos enteros) en ANTICIPO_MENSUAL_RELIQUIDACION.
  // Se agrego despues de la primera version de la tabla, asi que va por ALTER
  // (sirve igual en BD nueva, donde CREATE TABLE ya corrio arriba). Columna y
  // CHECK en batches separados: el CHECK referencia la columna recien agregada.
  // El CHECK solo prohibe el monto fuera de ese modo y los montos <= 0; que el
  // modo ANTICIPO lo EXIJA lo valida el controlador, porque exigirlo aca haria
  // fallar la migracion con los contratos ANTICIPO que ya existen sin monto.
  await runDdl(`
    IF COL_LENGTH('employee_contracts', 'gratification_monthly_advance') IS NULL
    BEGIN
      ALTER TABLE employee_contracts ADD gratification_monthly_advance INT NULL;
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_employee_contracts_grat_advance')
    BEGIN
      ALTER TABLE employee_contracts ADD CONSTRAINT chk_employee_contracts_grat_advance CHECK (
        gratification_monthly_advance IS NULL
        OR (gratification_monthly_advance > 0 AND gratification_payment_mode = 'ANTICIPO_MENSUAL_RELIQUIDACION')
      );
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_employee_contracts_open' AND object_id = OBJECT_ID('employee_contracts'))
    BEGIN
      CREATE UNIQUE INDEX ux_employee_contracts_open ON employee_contracts(employee_id) WHERE end_date IS NULL;
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_employee_contracts_employee_id' AND object_id = OBJECT_ID('employee_contracts'))
    BEGIN
      CREATE INDEX ix_employee_contracts_employee_id ON employee_contracts(employee_id, start_date);
    END
  `);

  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'gratification_movements')
    BEGIN
      CREATE TABLE gratification_movements (
        id INT IDENTITY(1,1) PRIMARY KEY,
        employee_id INT NOT NULL,
        contract_id INT NOT NULL,
        period DATE NOT NULL,
        type NVARCHAR(15) NOT NULL,
        calculation_base INT NOT NULL,
        percentage DECIMAL(5,2) NOT NULL,
        calculated_amount INT NOT NULL,
        paid_amount INT NOT NULL DEFAULT 0,
        ipc_factor DECIMAL(9,6) NULL,
        adjusted_amount INT NULL,
        status NVARCHAR(15) NOT NULL DEFAULT 'CALCULADO',
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_gratification_movements_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
        CONSTRAINT fk_gratification_movements_contract FOREIGN KEY (contract_id) REFERENCES employee_contracts(id),
        CONSTRAINT chk_gratification_movements_period CHECK (DAY(period) = 1),
        CONSTRAINT chk_gratification_movements_type CHECK (type IN ('ANTICIPO','RELIQUIDACION','PAGO')),
        CONSTRAINT chk_gratification_movements_status CHECK (status IN ('CALCULADO','PAGADO','RELIQUIDADO','ANULADO')),
        CONSTRAINT chk_gratification_movements_amounts CHECK (calculation_base >= 0 AND calculated_amount >= 0 AND paid_amount >= 0),
        CONSTRAINT chk_gratification_movements_ipc_v2 CHECK (
          (ipc_factor IS NULL AND adjusted_amount IS NULL)
          OR (ipc_factor IS NOT NULL AND ipc_factor > 0 AND adjusted_amount IS NOT NULL AND adjusted_amount >= 0)
        ),
        CONSTRAINT fk_gratification_movements_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_gratification_movements_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);
  // Mismo bug de NULL que los CHECK de employee_contracts (ver arriba): con
  // factor NULL y monto reajustado presente, la rama derecha daba UNKNOWN y pasaba.
  await runDdl(`
    IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_gratification_movements_ipc')
    BEGIN
      ALTER TABLE gratification_movements DROP CONSTRAINT chk_gratification_movements_ipc;
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'chk_gratification_movements_ipc_v2')
    BEGIN
      ALTER TABLE gratification_movements ADD CONSTRAINT chk_gratification_movements_ipc_v2 CHECK (
        (ipc_factor IS NULL AND adjusted_amount IS NULL)
        OR (ipc_factor IS NOT NULL AND ipc_factor > 0 AND adjusted_amount IS NOT NULL AND adjusted_amount >= 0)
      );
    END
  `);
  // Un movimiento por (contrato, periodo, tipo): evita anticipar dos veces el mismo mes.
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_gratification_movements_contract_period_type' AND object_id = OBJECT_ID('gratification_movements'))
    BEGIN
      CREATE UNIQUE INDEX ux_gratification_movements_contract_period_type ON gratification_movements(contract_id, period, type);
    END
  `);
  await runDdl(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_gratification_movements_employee_period' AND object_id = OBJECT_ID('gratification_movements'))
    BEGIN
      CREATE INDEX ix_gratification_movements_employee_period ON gratification_movements(employee_id, period);
    END
  `);
}
