import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ProtectedRoute } from "./ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { LoginPage } from "../pages/login/LoginPage";
import { ChangePasswordPage } from "../pages/login/ChangePasswordPage";
import { DashboardPage } from "../pages/dashboard/DashboardPage";
import { ModulePlaceholder } from "../pages/module-placeholder/ModulePlaceholder";
import { ForbiddenPage } from "../pages/forbidden/ForbiddenPage";
import CreateBusinessPartnerPage from "../pages/adquisiciones/proveedores/createBusinessPartner";
import CreateRequest from "../pages/solicitudes/CreateRequest";
import AproveRequest from "../pages/solicitudes/AproveRequest";
import RequestQuotation from "../pages/solicitudes/RequestQuotation";
import UploadQuotes from "../pages/solicitudes/UploadQuotes";
import ApproveQuote from "../pages/solicitudes/ApproveQuote";
import AttachPurchaseOrder from "../pages/solicitudes/AttachPurchaseOrder";
import SendPurchaseOrder from "../pages/solicitudes/SendPurchaseOrder";
import ReceiveGoods from "../pages/solicitudes/ReceiveGoods";
import RequestAssetStatus from "../pages/solicitudes/RequestAssetStatus";
import AssignAsset from "../pages/activos/AssignAsset";
import AssetKardex from "../pages/activos/AssetKardex";
import PrintAssetLabels from "../pages/activos/PrintAssetLabels";
import AssetValuation from "../pages/activos/AssetValuation";
import ImportAssets from "../pages/activos/ImportAssets";
import AssetReturns from "../pages/devoluciones/AssetReturns";
import InventoryCounts from "../pages/inventario/InventoryCounts";
import CreateProducts from "../pages/adquisiciones/productos/CreateProducts";
import ListProducts from "../pages/adquisiciones/productos/ListProducts";
import CreateProductCategory from "../pages/adquisiciones/category/CreateProductCategory";
import ViewProductCategory from "../pages/adquisiciones/category/ViewProductCategory";
import UpdateProductCategory from "../pages/adquisiciones/category/UpdateProductCategory";
import LinkSupplierProducts from "../pages/adquisiciones/supplierProducts/LinkSupplierProducts";
import NuevaPantalla from "../pages/pantallas/NuevaPantalla";
import AsignarPermisos from "../pages/pantallas/AsignarPermisos";
import VerPantallas from "../pages/pantallas/VerPantallas";
import ClasificacionContable from "../pages/contabilidad/ClasificacionContable";
import DeterminarCosto from "../pages/contabilidad/DeterminarCosto";
import Capitalizacion from "../pages/contabilidad/Capitalizacion";
import Depreciacion from "../pages/contabilidad/Depreciacion";
import PoliticaContable from "../pages/contabilidad/PoliticaContable";
import {
  AsignarPermissionToRole,
  DeshabilitarRoles,
  HabilitarRoles,
  PermisosDePantalla,
  NuevoPermiso,
  NuevoRole,
  VerPermisos,
} from "../pages/permissions";
import {
  ListarRole,
  CreatePersonPage,
  NuevoCargo,
  AsignarAfp,
  AsignarSalud,
  CcafMutualEmpresa,
  ConfiguracionRemuneraciones,
} from "../pages/personas";
import { flattenMenuLinks } from "../lib/menu";

// Vistas reales ya implementadas, mapeadas por el "link" exacto del
// catalogo de menu_items (ver POST /menu-items). Todo lo que no este aca
// sigue cayendo en ModulePlaceholder -asi que para que esta pantalla sea
// alcanzable hace falta ademas un menu_item activo con link="/suppliers/create".
const MODULE_PAGES: Record<string, () => ReactElement> = {
  "/suppliers/create": () => <CreateBusinessPartnerPage />,
  "/employees/create": () => <CreatePersonPage />,
  "/tickets/create": () => <CreateRequest />,
  "/products/create": () => <CreateProducts />,
  "/products/list": () => <ListProducts />,
  "/category/create": () => <CreateProductCategory />,
  "/category/view": () => <ViewProductCategory />,
  "/category/update": () => <UpdateProductCategory />,
  "/supplier-products/manage": () => <LinkSupplierProducts />,
  // Referencia diferida a MODULE_PAGES (se evalua al renderizar, no al
  // definir el objeto): la vista sugiere las rutas con pagina implementada.
  "/menu-items/create": () => <NuevaPantalla implementedLinks={Object.keys(MODULE_PAGES)} />,
  "/menu-items/update": () => <AsignarPermisos />,
  "/menu-items/read": () => <VerPantallas />,
  "/tickets/validate": () => <AproveRequest />,
  "/quotes/request": () => <RequestQuotation />,
  "/quotes/upload": () => <UploadQuotes />,
  "/quotes/approve": () => <ApproveQuote />,
  "/purchase-orders/attach": () => <AttachPurchaseOrder />,
  "/purchase-orders/send": () => <SendPurchaseOrder />,
  "/goods-receipts/create": () => <ReceiveGoods />,
  "/assets/assign": () => <AssignAsset />,
  "/solicitudes/estado-activos": () => <RequestAssetStatus />,
  "/assets/kardex": () => <AssetKardex />,
  "/assets/labels": () => <PrintAssetLabels />,
  "/inventory/counts": () => <InventoryCounts />,
  "/assets/valuation": () => <AssetValuation />,
  "/assets/returns": () => <AssetReturns />,
  "/assets/import": () => <ImportAssets />,
  // Contabilidad > Gestion de Activos (plan 007)
  "/accounting/classification": () => <ClasificacionContable />,
  "/accounting/cost": () => <DeterminarCosto />,
  "/accounting-capitalization": () => <Capitalizacion />,
  "/accounting/depreciation": () => <Depreciacion />,
  "/accounting/policy": () => <PoliticaContable />,
  "/roles/create": () => <NuevoRole />,
  "/permissions/create": () => <NuevoPermiso />,
  "/permissions/read": () => <VerPermisos />,
  "/permissions/update": () => <AsignarPermissionToRole />,
  "/permissions/access": () => <PermisosDePantalla />,
  "/roles/read": () => <ListarRole />,
  "/roles/deactivate": () => <DeshabilitarRoles />,
  "/roles/activate": () => <HabilitarRoles />,
  "/employees/cargos": () => <NuevoCargo />,
  "/employees/previsional/afp": () => <AsignarAfp />,
  "/employees/previsional/salud": () => <AsignarSalud />,
  "/company/previsional": () => <CcafMutualEmpresa />,
  "/payroll/settings": () => <ConfiguracionRemuneraciones />,
};

// Fuerza /change-password antes de cualquier otra ruta protegida mientras
// user.mustChangePassword sea true (primer login con password por defecto,
// o despues de un reset administrativo -ver /auth/me en auth.controller.ts).
// Va DESPUES de ProtectedRoute (ya exige sesion) y ANTES de AppLayout: nunca
// se llega a montar el sidebar/menu con una cuenta que todavia debe cambiar
// su password.
function MustChangePasswordGate() {
  const { user } = useAuth();
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

// Fuente unica de las rutas de modulo: el menu del usuario autenticado (ya
// podado por permisos, ver getMenuTreeForRole en corporate-api), no un
// archivo estatico. Lo que no esta en tu menu no existe para vos -el
// catch-all cae en ForbiddenPage, no en un 404: no hay forma de distinguir
// "no existe" de "existe pero no lo ves" sin filtrar informacion del
// catalogo completo a alguien sin permiso.
export function AppRoutes() {
  const { menu } = useAuth();
  const moduleLinks = flattenMenuLinks(menu);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        {/* Fuera del gate a proposito: si no fuera alcanzable durante
            mustChangePassword:true, nadie podria completar el cambio. */}
        <Route path="/change-password" element={<ChangePasswordPage />} />

        <Route element={<MustChangePasswordGate />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/403" element={<ForbiddenPage />} />

            {moduleLinks.map((item) => {
              const Page = MODULE_PAGES[item.link];
              return (
                <Route
                  key={item.link}
                  path={item.link}
                  element={Page ? <Page /> : <ModulePlaceholder title={item.label} />}
                />
              );
            })}

            <Route path="*" element={<ForbiddenPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
