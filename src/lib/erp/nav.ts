// Las entradas del menú del ERP y quién ve cada una (D-NEXT). Puro —sin React ni Next— para que la
// prueba lo IMPORTE en vez de leer side-nav.tsx como texto: lo que decide quién ve qué vive aquí, y
// la barra (side-nav.tsx) y la fila de pastillas de Analítica (analytics-nav.tsx) solo lo pintan.
//
// Antes de D-NEXT el bloque Analítica se filtraba ENTERO por `managerPlus` y «Dashboard» iba suelto
// arriba, visible para staff. El cliente pidió moverlo a Analítica como «Product Analytics»; si se
// hubiera movido sin más, staff lo habría perdido (el bloque entero era de manager+). Por eso la puerta
// es ahora por entrada, igual que en la lista principal: mover no ensancha ni estrecha quién lo ve.

import type { AppRole } from "@/lib/erp/domain/roles";
import { hasCatalogAccess } from "@/lib/erp/domain/modules";

export type NavItem = { href: string; label: string; managerPlus?: boolean };
type T = (en: string, es: string) => string;

/** La lista principal, en su orden. */
export const navItems = (t: T): NavItem[] => [
  { href: "/erp/catalog", label: t("Catalog", "Catálogo") },
  { href: "/erp/purchasing", label: t("Purchasing", "Compras"), managerPlus: true },
  { href: "/erp/purchasing/orders", label: t("PO ↔ Proforma", "OC ↔ Proforma"), managerPlus: true },
  { href: "/erp/purchasing/receiving", label: t("Receiving", "Recepción"), managerPlus: true },
  { href: "/erp/inventory", label: t("Inventory", "Inventario"), managerPlus: true },
  { href: "/erp/review", label: t("Review", "Revisión"), managerPlus: true },
  { href: "/erp/requests", label: t("Approvals", "Aprobaciones"), managerPlus: true },
  // Sin «PO upload» (/erp/po-upload) ni «Bulk apply» (/erp/decisions): ESCONDIDOS del menú a pedido del
  // cliente, no quitados (D-NEXT). Las dos páginas, sus componentes y sus acciones siguen igual y
  // funcionan por URL para manager/admin; nada más enlazaba a ellas. Para volver a enseñarlas, añadir
  // estas dos líneas aquí, después de «/erp/requests»:
  //   { href: "/erp/po-upload", label: t("PO upload", "Subir OC"), managerPlus: true },
  //   { href: "/erp/decisions", label: t("Bulk apply", "Aplicar en lote"), managerPlus: true },
  { href: "/erp/master", label: t("Excel round-trip", "Ida y vuelta Excel"), managerPlus: true },
  // Sin «Request» (/erp/request): una solicitud empieza ahora desde su fila del catálogo
  // (request-drawer.tsx, D-NEXT). La ruta se queda: marcadores viejos y «Tus solicitudes recientes».
];

/**
 * El bloque Analítica. «Product Analytics» es el antiguo «Dashboard» (/erp/dashboard), abierto a
 * todo el que tiene catálogo; los otros cuatro, manager+ como siempre.
 */
export const analyticsItems = (t: T): NavItem[] => [
  { href: "/erp/dashboard", label: t("Product Analytics", "Analítica de productos") },
  { href: "/erp/analytics/stores", label: t("Stores", "Tiendas"), managerPlus: true },
  { href: "/erp/analytics/vendors", label: t("Vendors", "Proveedores"), managerPlus: true },
  { href: "/erp/analytics/categories", label: t("Categories", "Categorías"), managerPlus: true },
  { href: "/erp/analytics/salespeople", label: t("Salespeople", "Vendedores"), managerPlus: true },
];

const esManagerPlus = (role: AppRole) => role === "admin" || role === "manager";

/** Lo que una persona ve en cada bloque. Sin catálogo (chofer, almacén: ADR 0010), nada. */
export function erpNav(role: AppRole, t: T): { main: NavItem[]; analytics: NavItem[] } {
  if (!hasCatalogAccess(role)) return { main: [], analytics: [] };
  const puede = (i: NavItem) => !i.managerPlus || esManagerPlus(role);
  return { main: navItems(t).filter(puede), analytics: analyticsItems(t).filter(puede) };
}
