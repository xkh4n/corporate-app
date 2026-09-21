import { Router } from "express";
import { authRouter } from "./auth.routes";
import { roleRouter } from "./role.routes";
import { permissionRouter } from "./permission.routes";
import { personRouter } from "./person.routes";
import { userRouter } from "./user.routes";
import { countryRouter } from "./country.routes";
import { cityRouter } from "./city.routes";
import { stateRouter } from "./state.routes";
import { costCenterRouter } from "./costCenter.routes";
import { menuItemRouter } from "./menuItem.routes";
import { businessPartnerRouter } from "./businessPartner.routes";
import { supplierRouter } from "./supplier.routes";
import { supplierServiceTypeRouter } from "./supplierServiceType.routes";
import { supplierDeliveryTermsRouter } from "./supplierDeliveryTerms.routes";
import { supplierProductRouter } from "./supplierProduct.routes";
import { supplierContactRouter } from "./supplierContact.routes";
import { customerRouter } from "./customer.routes";
import { employeeRouter } from "./employee.routes";
import { positionRouter } from "./position.routes";
import { addressRouter } from "./address.routes";
import { productRouter } from "./product.routes";
import { productCategoryRouter } from "./productCategory.routes";
import { purchaseRequestRouter } from "./purchaseRequest.routes";
import { purchaseRequestLineRouter } from "./purchaseRequestLine.routes";
import { quoteRouter } from "./quote.routes";
import { authorizationRouter } from "./authorization.routes";
import { purchaseOrderRouter } from "./purchaseOrder.routes";
import { goodsReceiptRouter } from "./goodsReceipt.routes";
import { assetStatusRouter } from "./assetStatus.routes";
import { assetRouter } from "./asset.routes";
import { assetMovementRouter } from "./assetMovement.routes";
import { assetKardexRouter } from "./assetKardex.routes";
import { inventoryCountRouter } from "./inventoryCount.routes";
import { assetValuationRouter } from "./assetValuation.routes";
import { assetReturnRouter } from "./assetReturn.routes";
import { notificationRouter } from "./notification.routes";
import { previsionalInstitutionRouter } from "./previsionalInstitution.routes";
import { previsionalProfileRouter } from "./previsionalProfile.routes";
import { previredSettingsRouter } from "./previredSettings.routes";
import { employeeContractRouter } from "./employeeContract.routes";
import { payrollSettingsRouter } from "./payrollSettings.routes";
import { payrollParameterRouter } from "./payrollParameter.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/roles", roleRouter);
apiRouter.use("/permissions", permissionRouter);
apiRouter.use("/menu-items", menuItemRouter);
apiRouter.use("/persons", personRouter);
apiRouter.use("/users", userRouter);

// Geografia
apiRouter.use("/countries", countryRouter);
apiRouter.use("/cities", cityRouter);
apiRouter.use("/states", stateRouter);

// Terceros, colaboradores, direcciones, catalogo de producto
apiRouter.use("/cost-centers", costCenterRouter);
apiRouter.use("/business-partners", businessPartnerRouter);
apiRouter.use("/suppliers", supplierRouter);
apiRouter.use("/supplier-service-types", supplierServiceTypeRouter);
apiRouter.use("/supplier-delivery-terms", supplierDeliveryTermsRouter);
apiRouter.use("/supplier-products", supplierProductRouter);
apiRouter.use("/supplier-contacts", supplierContactRouter);
apiRouter.use("/customers", customerRouter);
apiRouter.use("/employees", employeeRouter);
apiRouter.use("/positions", positionRouter);
apiRouter.use("/addresses", addressRouter);
apiRouter.use("/products", productRouter);
apiRouter.use("/product-categories", productCategoryRouter);

// Cotizaciones previsionales (nomina Previred): catalogo de instituciones,
// afiliacion por colaborador y configuracion de la empresa (CCAF/mutual)
apiRouter.use("/previsional-institutions", previsionalInstitutionRouter);
apiRouter.use("/previsional-profiles", previsionalProfileRouter);
apiRouter.use("/previred-settings", previredSettingsRouter);

// Remuneraciones: contrato del colaborador (sueldo + gratificacion), configuracion
// de la empresa y parametros monetarios (IMM)
apiRouter.use("/employee-contracts", employeeContractRouter);
apiRouter.use("/payroll-settings", payrollSettingsRouter);
apiRouter.use("/payroll-parameters", payrollParameterRouter);

// Flujo de compras: PurchaseRequest -> Quote -> Authorization -> PurchaseOrder -> GoodsReceipt
apiRouter.use("/purchase-requests", purchaseRequestRouter);
apiRouter.use("/purchase-request-lines", purchaseRequestLineRouter);
apiRouter.use("/quotes", quoteRouter);
apiRouter.use("/authorizations", authorizationRouter);
apiRouter.use("/purchase-orders", purchaseOrderRouter);
apiRouter.use("/goods-receipts", goodsReceiptRouter);

// Activos
apiRouter.use("/asset-statuses", assetStatusRouter);
apiRouter.use("/assets", assetRouter);
apiRouter.use("/asset-movements", assetMovementRouter);
apiRouter.use("/asset-kardex", assetKardexRouter);
apiRouter.use("/inventory-counts", inventoryCountRouter);
apiRouter.use("/asset-valuation", assetValuationRouter);
apiRouter.use("/asset-returns", assetReturnRouter);

// Resumen derivado de pendientes del usuario logeado (badge + push en
// tiempo real, ver library/realtime/).
apiRouter.use("/notifications", notificationRouter);
