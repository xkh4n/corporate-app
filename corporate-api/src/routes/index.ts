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
import { businessPartnerRouter } from "./businessPartner.routes";
import { supplierRouter } from "./supplier.routes";
import { supplierServiceTypeRouter } from "./supplierServiceType.routes";
import { supplierDeliveryTermsRouter } from "./supplierDeliveryTerms.routes";
import { supplierProductRouter } from "./supplierProduct.routes";
import { supplierContactRouter } from "./supplierContact.routes";
import { customerRouter } from "./customer.routes";
import { employeeRouter } from "./employee.routes";
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

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/roles", roleRouter);
apiRouter.use("/permissions", permissionRouter);
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
apiRouter.use("/addresses", addressRouter);
apiRouter.use("/products", productRouter);
apiRouter.use("/product-categories", productCategoryRouter);

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
