// Registra las asociaciones de Sequelize (belongsTo/hasOne/hasMany en cada
// *.model.ts) antes de que cualquier query las necesite. Extraido de index.ts
// a un modulo propio de solo efectos secundarios para que test/setupIntegration.ts
// (Fase 0) pueda importar exactamente el mismo grafo de modelos sin duplicar
// esta lista -una lista duplicada es una lista que se desincroniza el dia que
// alguien agregue un modelo nuevo y solo actualice index.ts.
import "./../models/mssql/person.model";
import "./../models/mssql/user.model";
import "./../models/mssql/passwordHistory.model";
import "./../models/postgres/role.model";
import "./../models/postgres/permission.model";
import "./../models/postgres/rolePermission.model";
import "./../models/postgres/menuItem.model";

// Geografia (country -> city -> states)
import "./../models/mssql/country.model";
import "./../models/mssql/city.model";
import "./../models/mssql/state.model";

// Terceros (business_partners + extensiones supplier/customer) y empleados
import "./../models/mssql/businessPartner.model";
import "./../models/mssql/supplierServiceType.model";
import "./../models/mssql/supplierDeliveryTerms.model";
import "./../models/mssql/supplier.model";
import "./../models/mssql/supplierProduct.model";
import "./../models/mssql/supplierContact.model";
import "./../models/mssql/customer.model";
import "./../models/mssql/employee.model";
import "./../models/mssql/address.model";

// Flujo de compras: PurchaseRequest -> Quote -> Authorization -> PurchaseOrder -> GoodsReceipt
import "./../models/mssql/purchaseRequest.model";
import "./../models/mssql/purchaseRequestLine.model";
import "./../models/mssql/quote.model";
import "./../models/mssql/authorization.model";
import "./../models/mssql/purchaseOrder.model";
import "./../models/mssql/purchaseOrderQuote.model";
import "./../models/mssql/goodsReceipt.model";

// Activos (Postgres)
import "./../models/postgres/costCenter.model";
import "./../models/postgres/assetStatus.model";
import "./../models/postgres/asset.model";
import "./../models/postgres/assetMovement.model";
import "./../models/postgres/assetMovementUser.model";
