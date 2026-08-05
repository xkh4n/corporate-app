import { mssql } from "./connection";
import { logger } from "../../library/logger";

// Igual criterio que databases/postgres/migrate.ts: migracion propia de la
// app, idempotente via guards IF NOT EXISTS (MSSQL no soporta
// "CREATE TABLE IF NOT EXISTS"). El AG (corporate-infra) replica el esquema
// del primario al secundario automaticamente al ser DDL sobre una base ya
// unida al Availability Group -no hace falta correr esto contra el secundario-.
export async function migrateMssql(): Promise<void> {
  await migrateAuth();
  await migrateGeography();
  await migrateBusinessPartners();
  await migratePurchasingFlow();
  await migrateDocumentNumbering();

  logger.info("Migracion de MSSQL aplicada");
}

// Contador atomico para los numeros de documento (SOL/COT/OC), ver
// library/documentNumbering.ts. Una fila por tipo, incrementada con
// "UPDATE ... OUTPUT" dentro de la MISMA transaccion que la cabecera -si esa
// transaccion hace rollback, el numero tambien se revierte (a diferencia de
// una secuencia de motor, que no hace rollback y deja "huecos"). Ver
// memoria convention-pk-id-strategy.
async function migrateDocumentNumbering(): Promise<void> {
  await mssql.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'document_numbering')
    BEGIN
      CREATE TABLE document_numbering (
        doc_type NVARCHAR(10) PRIMARY KEY,
        next_seq INT NOT NULL DEFAULT 0
      );
    END
  `);

  for (const docType of ["SOL", "COT", "OC"]) {
    await mssql.query(
      `IF NOT EXISTS (SELECT 1 FROM document_numbering WHERE doc_type = :docType)
       INSERT INTO document_numbering (doc_type, next_seq) VALUES (:docType, 0);`,
      { replacements: { docType } },
    );
  }
}

async function migrateAuth(): Promise<void> {
  await mssql.query(`
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

  await mssql.query(`
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
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_users_person FOREIGN KEY (person_id) REFERENCES persons(id)
      );
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
  await mssql.query(`
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

  await mssql.query(`
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

  await mssql.query(`
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
}

// business_partners es la entidad base (razonSocial/rut/giro compartidos);
// suppliers/customers son extensiones 1:1 -evita duplicar esos campos y el
// riesgo de inconsistencia si una misma empresa es cliente y proveedor a la
// vez (ver memoria project-erp-scope-and-data-classification). employees
// extiende persons con el mismo patron 1:1 que ya existe entre persons/users
// -no repite rut/dni: persons.document_id ya cubre eso, agregarlo de nuevo
// aca hubiera sido un campo redundante-.
async function migrateBusinessPartners(): Promise<void> {
  await mssql.query(`
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

  await mssql.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'suppliers')
    BEGIN
      CREATE TABLE suppliers (
        id INT IDENTITY(1,1) PRIMARY KEY,
        business_partner_id INT NOT NULL UNIQUE,
        service_type NVARCHAR(20) NOT NULL,
        payment_term_days INT NOT NULL DEFAULT 0,
        delivery_terms NVARCHAR(20) NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_suppliers_business_partner FOREIGN KEY (business_partner_id) REFERENCES business_partners(id),
        CONSTRAINT chk_suppliers_service_type CHECK (service_type IN ('LEASE','SERVICE','SALE')),
        CONSTRAINT chk_suppliers_delivery_terms CHECK (delivery_terms IN ('ON_PURCHASE_ORDER','ON_INVOICE')),
        CONSTRAINT fk_suppliers_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_suppliers_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await mssql.query(`
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

  await mssql.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'employees')
    BEGIN
      CREATE TABLE employees (
        id INT IDENTITY(1,1) PRIMARY KEY,
        person_id INT NOT NULL UNIQUE,
        employee_code NVARCHAR(20) NOT NULL UNIQUE,
        cost_center_id INT NOT NULL,
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

  // Depende de states (migrateGeography) y business_partners (arriba en
  // esta misma funcion) -por eso addresses no vive en migrateGeography,
  // pese a estar tematicamente ligada a la jerarquia geografica.
  await mssql.query(`
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
}

// Cadena PurchaseRequest -> PurchaseRequestLine -> Quote -> Authorization ->
// PurchaseOrder -> GoodsReceipt, toda en MSSQL con FK reales (ver memoria
// project-erp-scope-and-data-classification: cabecera+detalle no se
// reparten entre motores para no perder atomicidad/integridad referencial
// justo en el punto de reconciliacion mas sensible). product_id queda como
// NVARCHAR(24) -un ObjectId de Mongo, referencia cross-engine sin FK real,
// validada en la capa de servicio-.
async function migratePurchasingFlow(): Promise<void> {
  await mssql.query(`
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
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_purchase_requests_requester FOREIGN KEY (requester_id) REFERENCES persons(id),
        CONSTRAINT fk_purchase_requests_beneficiary FOREIGN KEY (beneficiary_id) REFERENCES persons(id),
        CONSTRAINT fk_purchase_requests_beneficiary_user FOREIGN KEY (beneficiary_user_id) REFERENCES users(id),
        CONSTRAINT fk_purchase_requests_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_purchase_requests_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await mssql.query(`
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

  await mssql.query(`
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

  await mssql.query(`
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

  await mssql.query(`
    IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'purchase_orders')
    BEGIN
      CREATE TABLE purchase_orders (
        id INT IDENTITY(1,1) PRIMARY KEY,
        order_number NVARCHAR(20) NOT NULL UNIQUE,
        quote_id INT NOT NULL,
        issued_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        payment_terms NVARCHAR(50) NULL,
        supplier_id INT NOT NULL,
        created_by INT NULL,
        updated_by INT NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT fk_purchase_orders_quote FOREIGN KEY (quote_id) REFERENCES quotes(id),
        CONSTRAINT fk_purchase_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        CONSTRAINT fk_purchase_orders_created_by FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_purchase_orders_updated_by FOREIGN KEY (updated_by) REFERENCES users(id)
      );
    END
  `);

  await mssql.query(`
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
}
