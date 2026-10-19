// El menú del ERP y quién ve cada cosa (D-553, D-NEXT). Puro —sin React ni Next— para que la prueba
// lo IMPORTE en vez de leer side-nav.tsx como texto: lo que decide quién ve qué vive aquí, y la barra
// (side-nav.tsx) y la fila de pestañas de cada grupo (group-tabs.tsx) solo lo pintan.
//
// Antes de D-553 el bloque Analítica se filtraba ENTERO por `managerPlus` y «Dashboard» iba suelto
// arriba, visible para staff. El cliente pidió moverlo a Analítica como «Product Analytics»; si se
// hubiera movido sin más, staff lo habría perdido (el bloque entero era de manager+). Por eso la puerta
// es por entrada: mover no ensancha ni estrecha quién lo ve.
//
// D-NEXT: el dueño pidió juntar entradas. «Inventory», «Review» y «Approvals» son ahora PESTAÑAS de
// Catálogo; «PO ↔ Proforma» y «Receiving», pestañas de Compras; y Analítica es UNA entrada en la barra
// (sus cinco pantallas se navegan solo con la fila de pestañas de dentro). Cada pestaña conserva la
// puerta por rol que tenía como entrada —agrupar tampoco ensancha ni estrecha—, y las rutas no cambian:
// una pestaña es un enlace a la MISMA página de antes, así que los marcadores viejos siguen valiendo.

import type { AppRole } from "@/lib/erp/domain/roles";
import { hasCatalogAccess } from "@/lib/erp/domain/modules";

export type GrupoId = "catalog" | "purchasing" | "analytics";
export type NavItem = { href: string; label: string; managerPlus?: boolean; grupo?: GrupoId };
export type NavGroup = NavItem & { grupo: GrupoId; tabs: NavItem[] };
type T = (en: string, es: string) => string;

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

/**
 * Los tres grupos con pestañas. El `href` del grupo es su primera pestaña, la que puede ver todo el
 * que ve el grupo. Las pestañas de manager+ eran entradas de manager+ antes de D-NEXT: misma puerta.
 */
export const grupos = (t: T): NavGroup[] => [
  {
    grupo: "catalog", href: "/erp/catalog", label: t("Catalog", "Catálogo"),
    tabs: [
      { href: "/erp/catalog", label: t("Catalog", "Catálogo") },
      { href: "/erp/inventory", label: t("Inventory", "Inventario"), managerPlus: true },
      { href: "/erp/review", label: t("Review", "Revisión"), managerPlus: true },
      { href: "/erp/requests", label: t("Approvals", "Aprobaciones"), managerPlus: true },
    ],
  },
  {
    grupo: "purchasing", href: "/erp/purchasing", label: t("Purchasing", "Compras"), managerPlus: true,
    tabs: [
      { href: "/erp/purchasing", label: t("Purchasing", "Compras"), managerPlus: true },
      { href: "/erp/purchasing/orders", label: t("PO ↔ Proforma", "OC ↔ Proforma"), managerPlus: true },
      { href: "/erp/purchasing/receiving", label: t("Receiving", "Recepción"), managerPlus: true },
    ],
  },
  { grupo: "analytics", href: "/erp/dashboard", label: t("Analytics", "Analítica"), tabs: analyticsItems(t) },
];

/** La lista principal de la barra, en su orden: los grupos y lo que sigue suelto. */
export const navItems = (t: T): NavItem[] => {
  const [catalogo, compras, analitica] = grupos(t).map(({ tabs: _tabs, ...entrada }) => entrada);
  return [
    catalogo,
    compras,
    // Sin «PO upload» (/erp/po-upload) ni «Bulk apply» (/erp/decisions): ESCONDIDOS del menú a pedido del
    // cliente, no quitados (D-553). Las dos páginas, sus componentes y sus acciones siguen igual y
    // funcionan por URL para manager/admin; nada más enlazaba a ellas. Para volver a enseñarlas, añadir
    // estas dos líneas aquí, antes de «/erp/master»:
    //   { href: "/erp/po-upload", label: t("PO upload", "Subir OC"), managerPlus: true },
    //   { href: "/erp/decisions", label: t("Bulk apply", "Aplicar en lote"), managerPlus: true },
    { href: "/erp/master", label: t("Excel round-trip", "Ida y vuelta Excel"), managerPlus: true },
    // Sin «Request» (/erp/request): una solicitud empieza ahora desde su fila del catálogo
    // (request-drawer.tsx, D-553). La ruta se queda: marcadores viejos y «Tus solicitudes recientes».
    analitica,
  ];
};

const esManagerPlus = (role: AppRole) => role === "admin" || role === "manager";
const puedeVer = (role: AppRole) => (i: NavItem) => !i.managerPlus || esManagerPlus(role);

/**
 * Lo que una persona ve en la barra. Sin catálogo (chofer, almacén: ADR 0010), nada. `analytics` va
 * vacío desde D-NEXT (Analítica es una entrada de `main`); la clave se queda porque Clientes pasa la
 * misma forma a la barra (`otra.nav`).
 */
export function erpNav(role: AppRole, t: T): { main: NavItem[]; analytics: NavItem[] } {
  if (!hasCatalogAccess(role)) return { main: [], analytics: [] };
  return { main: navItems(t).filter(puedeVer(role)), analytics: [] };
}

/** Las pestañas de un grupo que este rol puede ver, en su orden. Sin catálogo, ninguna. */
export function pestanasDe(grupo: GrupoId, role: AppRole, t: T): NavItem[] {
  if (!hasCatalogAccess(role)) return [];
  const g = grupos(t).find((x) => x.grupo === grupo);
  return g ? g.tabs.filter(puedeVer(role)) : [];
}

/** ¿`pathname` está en `href` o debajo? Por segmento: /erp/request no está bajo /erp/requests. */
const debajoDe = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/**
 * La pestaña que corresponde a la ruta actual: la de href más largo que la cubre, para que
 * /erp/purchasing/orders encienda «PO ↔ Proforma» y no «Compras». `null` si ninguna la cubre.
 */
export function pestanaActiva(tabs: NavItem[], pathname: string): string | null {
  let mejor: string | null = null;
  for (const tab of tabs) {
    if (debajoDe(pathname, tab.href) && (mejor === null || tab.href.length > mejor.length)) mejor = tab.href;
  }
  return mejor;
}

/** El grupo al que pertenece la ruta (por sus pestañas, con sus subrutas), o `null`. */
export function grupoDe(pathname: string): GrupoId | null {
  const sinT: T = (en) => en;
  for (const g of grupos(sinT)) if (pestanaActiva(g.tabs, pathname) !== null) return g.grupo;
  return null;
}

/**
 * La entrada de la barra que se enciende para esta ruta: una entrada con `grupo` se enciende por
 * cualquiera de sus pestañas (Catálogo también en /erp/inventory); una suelta, por su propio href.
 */
export function entradaActiva(items: NavItem[], pathname: string): string | null {
  const g = grupoDe(pathname);
  const hit = items.find((i) => (i.grupo ? i.grupo === g : debajoDe(pathname, i.href)));
  return hit ? hit.href : null;
}
