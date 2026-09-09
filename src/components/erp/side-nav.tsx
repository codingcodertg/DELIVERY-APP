"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/erp/ui/badge";
import { cn } from "@/lib/erp/utils";
import type { AppRole } from "@/lib/erp/domain/roles";
import { hasCatalogAccess } from "@/lib/erp/domain/modules";
import { useErpNav } from "@/components/erp/nav-state";
import { usePrefs } from "@/lib/prefs";

const roleStyles: Record<string, string> = {
  admin: "border-clay-200 bg-clay-50 text-clay-700",
  manager: "border-slate-200 bg-slate-100 text-slate-600",
  staff: "border-slate-200 bg-slate-100 text-slate-600",
};

type Item = { href: string; label: string; managerPlus?: boolean };
type T = (en: string, es: string) => string;

// G-10 (D-203): el ERP habla el idioma del HUB (usePrefs, la misma preferencia que Entregas y HR),
// con pares inline. Las etiquetas del menú se construyen con t() dentro del render en vez de en
// una constante de módulo, porque una constante no puede cambiar de idioma.
const items = (t: T): Item[] => [
  { href: "/erp/dashboard", label: t("Dashboard", "Panel") },
  { href: "/erp/catalog", label: t("Catalog", "Catálogo") },
  { href: "/erp/purchasing", label: t("Purchasing", "Compras"), managerPlus: true },
  { href: "/erp/purchasing/orders", label: t("PO ↔ Proforma", "OC ↔ Proforma"), managerPlus: true },
  { href: "/erp/purchasing/receiving", label: t("Receiving", "Recepción"), managerPlus: true },
  { href: "/erp/inventory", label: t("Inventory", "Inventario"), managerPlus: true },
  { href: "/erp/review", label: t("Review", "Revisión"), managerPlus: true },
  { href: "/erp/requests", label: t("Approvals", "Aprobaciones"), managerPlus: true },
  { href: "/erp/po-upload", label: t("PO upload", "Subir OC"), managerPlus: true },
  { href: "/erp/decisions", label: t("Bulk apply", "Aplicar en lote"), managerPlus: true },
  { href: "/erp/master", label: t("Excel round-trip", "Ida y vuelta Excel"), managerPlus: true },
  { href: "/erp/request", label: t("Request", "Solicitud") },
];
const analytics = (t: T): Item[] => [
  { href: "/erp/analytics/stores", label: t("Stores", "Tiendas"), managerPlus: true },
  { href: "/erp/analytics/vendors", label: t("Vendors", "Proveedores"), managerPlus: true },
  { href: "/erp/analytics/categories", label: t("Categories", "Categorías"), managerPlus: true },
  { href: "/erp/analytics/salespeople", label: t("Salespeople", "Vendedores"), managerPlus: true },
];


export function SideNav({
  role,
  fullName,
  email,
  cost,
  hubReachable,
}: {
  role: AppRole;
  fullName: string | null;
  email: string;
  cost: boolean;
  /**
   * ¿Existe un hub al que volver para esta persona? (D-227)
   *
   * Lo decide `canReachHub` en `header.tsx`, la misma función que usan `/home` y el conmutador de
   * módulos. Aquí llega ya resuelto a propósito: si esta barra volviera a preguntarlo por su
   * cuenta, habría otra vez dos versiones de la misma regla — que es exactamente lo que dejó los
   * dos enlaces de abajo prometiendo un sitio al que la app no deja entrar.
   */
  hubReachable: boolean;
}) {
  const pathname = usePathname();
  const { t, lang, setLang } = usePrefs();
  const managerPlus = role === "admin" || role === "manager";
  // Catalog nav is hidden entirely from the delivery-floor roles the merge added (ADR 0010): a
  // driver has no reason to browse the product master, and a list of links that all redirect is
  // worse than no list.
  const { collapsed, toggle } = useErpNav();
  const catalog = hasCatalogAccess(role);
  const navItems = catalog ? items(t).filter((i) => !i.managerPlus || managerPlus) : [];
  const analyticsItems = catalog && managerPlus ? analytics(t) : [];
  // Exact-match the roots that have deeper siblings (/, /purchasing) so a sub-route like
  // /purchasing/orders highlights only its own item, not its parent.
  const exact = new Set(["/erp/purchasing"]);
  const active = (href: string) => (exact.has(href) ? pathname === href : pathname.startsWith(href));

  // Two things, not one: the product name (where you are) and the way back to the
  // hub (where you can go). They were both whispering at 14px/12px, and the hub
  // link is the only exit from this module now that the switcher is gone — it
  // should be legible.
  // One row: the product name and the way out, side by side. Two stacked lines cost a second
  // row of header height for no gain, and the hub link is the only exit from this module since
  // the switcher was removed — it belongs next to the name, not under it.
  const brand = (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-base font-bold tracking-tight text-clay-600">RTG ERP</span>
      {hubReachable && (
        <Link
          href="/home"
          title={t("All apps", "Todas las apps")}
          className="shrink-0 text-sm text-slate-500 hover:text-clay-700"
        >
          <span aria-hidden="true">⌂</span> {t("All apps", "Todas las apps")}
        </Link>
      )}
    </div>
  );
  // El conmutador de idioma, como en las barras de HR y Time Tracker: un botón que alterna y
  // enseña el idioma AL QUE se cambia. Es la preferencia del hub: cambiarla aquí cambia también
  // Entregas y HR, y al revés, que es lo que se quiere de una sola preferencia.
  const langToggle = (
    <button
      type="button"
      onClick={() => setLang(lang === "es" ? "en" : "es")}
      title={t("Switch to Spanish", "Cambiar a inglés")}
      className="rounded-md px-2 py-1.5 text-slate-500 hover:bg-slate-100"
    >
      {lang === "es" ? "🇬🇧 EN" : "🇪🇸 ES"}
    </button>
  );
  const signout = (
    <form action="/auth/signout" method="post">
      <button type="submit" className="rounded-md px-3 py-1.5 text-slate-500 hover:bg-slate-100">
        {t("Sign out", "Salir")}
      </button>
    </form>
  );
  const linkCls = (href: string) =>
    cn(
      "rounded-md px-3 py-2 text-slate-600 hover:bg-clay-50 hover:text-clay-700",
      active(href) && "bg-clay-50 font-medium text-clay-700"
    );

  const burger = (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? t("Show menu", "Mostrar menú") : t("Hide menu", "Ocultar menú")}
      aria-expanded={!collapsed}
      title={collapsed ? t("Show menu", "Mostrar menú") : t("Hide menu", "Ocultar menú")}
      className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );

  return (
    <>
      {/* Collapsed: the only way back. Fixed so it stays put while the page scrolls, and
          desktop-only because the mobile layout has its own top bar below. */}
      {collapsed && (
        <div className="fixed left-2 top-2 z-40 hidden lg:block">
          <div className="rounded-md border border-slate-200 bg-white shadow-sm">{burger}</div>
        </div>
      )}

      {/* Desktop: fixed left sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-slate-200 bg-white",
          collapsed ? "lg:hidden" : "lg:flex"
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-1 px-2">
          {burger}
          <div className="min-w-0 flex-1">{brand}</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2 text-sm">
          {/* Este comentario decía «siempre visible… aquí el hub nunca es un callejón sin
              salida», y era falso (D-227): el ERP también puede ser el único módulo de alguien,
              exactamente como en rtg-erp. Quien está en ese caso pulsaba, `/home` lo devolvía al
              ERP y no veía ni un error — la pantalla parpadeaba y seguía donde estaba.
              Ahora se pinta solo si hay hub al que volver, con la misma respuesta que el enlace
              de la cabecera: los dos salen de `hubReachable`, así que no pueden discrepar. */}
          {hubReachable && (
            <Link
              href="/home"
              className="mb-2 block rounded-md px-3 py-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              ⌂ {t("All apps", "Todas las apps")}
            </Link>
          )}
          {navItems.map((i) => (
            <Link key={i.href} href={i.href} className={cn("block", linkCls(i.href))}>
              {i.label}
            </Link>
          ))}
          {analyticsItems.length > 0 && (
            <div className="pt-3">
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t("Analytics", "Analítica")}</div>
              {analyticsItems.map((i) => (
                <Link key={i.href} href={i.href} className={cn("block", linkCls(i.href))}>
                  {i.label}
                </Link>
              ))}
            </div>
          )}
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-3 text-sm">
          <div className="mb-2 flex items-center gap-2">
            <Badge className={roleStyles[role] ?? roleStyles.staff}>{role}</Badge>
            <span
              className="text-xs text-slate-400"
              title={t("Cost & margin visibility is enforced at the database (#29)", "La visibilidad de costo y margen la impone la base de datos (#29)")}
            >
              {cost ? t("cost visible", "costo visible") : t("cost hidden", "costo oculto")}
            </span>
          </div>
          <div className="leading-tight">
            <div className="truncate font-medium">{fullName ?? email}</div>
            <div className="truncate text-xs text-slate-400">{email}</div>
          </div>
          <div className="mt-2 flex items-center gap-1">{langToggle}{signout}</div>
        </div>
      </aside>

      {/* Mobile: top bar with horizontal nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          {brand}
          <div className="ml-auto flex items-center gap-2">
            <Badge className={roleStyles[role] ?? roleStyles.staff}>{role}</Badge>
            {langToggle}
            {signout}
          </div>
        </div>
        {/* Envuelve en vez de cortar (D-175, patrón de D-055). `overflow-x-auto` escondía
            media barra detrás de un scroll horizontal que en un móvil nadie descubre; con
            `flex-wrap` las pestañas bajan de línea. `min-w-0` es la otra mitad del patrón:
            un flex item mide por defecto lo que su hijo más ancho, y sin esto la fila se
            niega a encoger por debajo de la pestaña más larga. Cada enlace conserva su
            `whitespace-nowrap`: se parte la fila, no la palabra. */}
        <nav className="flex min-w-0 flex-wrap items-center gap-1 border-t border-slate-100 px-2 py-1.5 text-sm">
          {navItems
            .concat(analyticsItems)
            .map((i) => (
            <Link key={i.href} href={i.href} className={cn("whitespace-nowrap", linkCls(i.href))}>
              {i.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
