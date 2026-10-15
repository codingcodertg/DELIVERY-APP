import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CAP_TODAS_LAS_TIENDAS, seOfreceTodasLasTiendas, veTodasLasTiendas } from "./todas-las-tiendas";
import { alcanceDelPanel, choferesDelPanel } from "./panel-por-tienda";
import { alcanceDeLaLista, alcanceDePendientes, ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { CAPABILITIES, MODULE_ACCESS, ROLE_CAPS, extraCaps, hasCap } from "./constants";
import { mkDelivery } from "./__fixtures";
import { todayISO } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation, Profile, UserRole } from "./types";

/**
 * «Ver todas las tiendas» (`all_stores`, D-559).
 *
 * El dueño, 2026-10-15, al preguntarle si el «Operations Manager» ve una tienda o todas: «por ahora se llamara francis y
 * todas». Las tiendas aquí son Norte, Sur y Oeste: las reales son datos del dueño y viven en Ajustes.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");

/** Norte y Sur trabajan juntas (D-293); Oeste va sola. */
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave", group: "G1" },
  { name: "Tienda Sur", address: "200 Sur Blvd", group: "G1" },
  { name: "Tienda Oeste", address: "300 Oeste Rd" },
];
const REGLAS: OrderTypeRules = { ConFactura: { docRef: "invoice" } };

type Yo = Pick<Profile, "id" | "role" | "store" | "permissions">;
const yo = (role: UserRole, store: string | null, permissions: string[] | null = null): Yo => ({ id: "u-yo", role, store, permissions });

const ROLES_SIN_ELLA: UserRole[] = ["sales", "accounting", "warehouse", "driver"];

describe("1 · quién ve todas las tiendas", () => {
  it("el gerente CON la capacidad, sí; sin ella, no", () => {
    expect(veTodasLasTiendas(yo("manager", null, [CAP_TODAS_LAS_TIENDAS]))).toBe(true);
    expect(veTodasLasTiendas(yo("manager", "Tienda Norte", [CAP_TODAS_LAS_TIENDAS]))).toBe(true);
    expect(veTodasLasTiendas(yo("manager", "Tienda Norte"))).toBe(false);
    expect(veTodasLasTiendas(yo("manager", null, []))).toBe(false);
  });
  it("otra palabra en la lista —la de Leads, o «history»— no amplía las tiendas de Entregas", () => {
    expect(veTodasLasTiendas(yo("manager", null, ["leads_all_stores", "history", "dashboard"]))).toBe(false);
  });
  it("admin y logística, siempre, sin la palabra", () => {
    expect(veTodasLasTiendas(yo("admin", null))).toBe(true);
    expect(veTodasLasTiendas(yo("logistics", null))).toBe(true);
  });
  it("a ventas, oficina, almacén o chofer la palabra escrita a mano NO les sirve", () => {
    for (const r of ROLES_SIN_ELLA) expect(veTodasLasTiendas(yo(r, null, [CAP_TODAS_LAS_TIENDAS])), r).toBe(false);
  });
  it("sin saber quién mira, no", () => {
    expect(veTodasLasTiendas(null)).toBe(false);
    expect(veTodasLasTiendas(undefined)).toBe(false);
  });
  it("se ofrece solo al gerente", () => {
    expect(seOfreceTodasLasTiendas("manager")).toBe(true);
    for (const r of ["admin", "logistics", ...ROLES_SIN_ELLA]) expect(seOfreceTodasLasTiendas(r), r).toBe(false);
  });
});

describe("2 · el Panel (alcanceDelPanel)", () => {
  it("Francis: gerente sin tienda y con la capacidad → todas", () => {
    expect(alcanceDelPanel(yo("manager", null, [CAP_TODAS_LAS_TIENDAS]), TIENDAS)).toEqual({ tipo: "todas" });
  });
  it("un campo sin rellenar sigue sin ampliar nada (D-237): gerente sin tienda y sin la capacidad → sin-tienda", () => {
    expect(alcanceDelPanel(yo("manager", null), TIENDAS)).toEqual({ tipo: "sin-tienda" });
    expect(alcanceDelPanel(yo("manager", null, ["leads_all_stores"]), TIENDAS)).toEqual({ tipo: "sin-tienda" });
  });
  it("con tienda, la capacidad abre de su grupo a todas", () => {
    const sin = alcanceDelPanel(yo("manager", "Tienda Oeste"), TIENDAS);
    expect(sin.tipo).toBe("tiendas");
    expect(alcanceDelPanel(yo("manager", "Tienda Oeste", [CAP_TODAS_LAS_TIENDAS]), TIENDAS)).toEqual({ tipo: "todas" });
  });
  it("a un vendedor con la palabra no le abre nada", () => {
    expect(alcanceDelPanel(yo("sales", null, [CAP_TODAS_LAS_TIENDAS]), TIENDAS)).toEqual({ tipo: "sin-tienda" });
    expect(alcanceDelPanel(yo("sales", "Tienda Oeste", [CAP_TODAS_LAS_TIENDAS]), TIENDAS).tipo).toBe("tiendas");
  });
  it("«Tiempo inactivo» cuenta a todos los choferes (null), como para admin", () => {
    expect(choferesDelPanel(alcanceDelPanel(yo("manager", null, [CAP_TODAS_LAS_TIENDAS]), TIENDAS), [])).toBeNull();
  });
});

describe("3 · la lista de Órdenes y «Factura pendiente»", () => {
  const HOY = todayISO();
  const ctx = (me: Yo, over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
    me, teaching: false, veTodoElHistorial: false, busqueda: "", reglas: REGLAS, tiendas: TIENDAS, tiendasDeAlmacen: [], ...over,
  });
  // Desordenadas a propósito, y de tres tiendas: un corte que dejara pasar solo la primera o la lista tal cual no pasa.
  const ORDENES: Delivery[] = [
    mkDelivery({ id: "oeste", store: "Tienda Oeste", stage: "approved", delivery_date: HOY, created_by: "u-otro", order_type: "ConFactura", invoice_num: "F-1" }),
    mkDelivery({ id: "norte", store: "Tienda Norte", stage: "approved", delivery_date: HOY, created_by: "u-otro", order_type: "ConFactura", invoice_num: "F-1" }),
    mkDelivery({ id: "pend-sur", store: "Tienda Sur", stage: "delivered", delivery_date: HOY, created_by: "u-otro", order_type: "ConFactura", invoice_num: null }),
  ];
  const ids = (l: Delivery[]) => l.map((d) => d.id).sort();

  it("Francis (sin tienda, con la capacidad) ve las de todas las tiendas, en la lista y en «Factura pendiente»", () => {
    const r = ordenesVisibles(ORDENES, ctx(yo("manager", null, [CAP_TODAS_LAS_TIENDAS])));
    expect(r.alcanceLista).toEqual({ tipo: "todas" });
    expect(r.alcancePendientes).toEqual({ tipo: "todas" });
    expect(ids(r.visibles)).toEqual(["norte", "oeste", "pend-sur"]);
    // `conPendientes` es la base de la pestaña (ventana y tiendas); qué le falta a cada una lo decide la pestaña después.
    expect(ids(r.conPendientes)).toEqual(["norte", "oeste", "pend-sur"]);
  });
  it("sin la capacidad, el mismo gerente sin tienda no ve nada (D-237), y el aviso sale", () => {
    const r = ordenesVisibles(ORDENES, ctx(yo("manager", null)));
    expect(r.alcanceLista).toEqual({ tipo: "sin-tienda" });
    expect(ids(r.visibles)).toEqual([]);
    expect(ids(r.conPendientes)).toEqual([]);
  });
  it("con tienda y sin la capacidad, solo su grupo; con ella, todas — también buscando", () => {
    expect(ids(ordenesVisibles(ORDENES, ctx(yo("manager", "Tienda Norte"))).visibles)).toEqual(["norte", "pend-sur"]);
    expect(alcanceDeLaLista(ctx(yo("manager", "Tienda Norte", [CAP_TODAS_LAS_TIENDAS]), { busqueda: "x" }))).toEqual({ tipo: "todas" });
    expect(alcanceDePendientes(ctx(yo("manager", "Tienda Norte", [CAP_TODAS_LAS_TIENDAS])))).toEqual({ tipo: "todas" });
  });
  it("un vendedor con la palabra sigue cortado a su tienda", () => {
    expect(alcanceDeLaLista(ctx(yo("sales", "Tienda Oeste", [CAP_TODAS_LAS_TIENDAS]))).tipo).toBe("tiendas");
  });
});

describe("4 · la casilla en Usuarios", () => {
  const entregas = MODULE_ACCESS.find((m) => m.key === "deliveries")!;
  it("es una capacidad de Entregas, con la palabra «all_stores» y el rótulo «Ver todas las tiendas»", () => {
    expect(CAP_TODAS_LAS_TIENDAS).toBe("all_stores");
    const c = CAPABILITIES.find((x) => x.key === CAP_TODAS_LAS_TIENDAS);
    expect(c).toMatchObject({ es: "Ver todas las tiendas", en: "See all stores" });
    expect(entregas.capabilities?.map((x) => x.key)).toContain(CAP_TODAS_LAS_TIENDAS);
  });
  it("al gerente se le ofrece apagable (no viene de su rol)", () => {
    expect(entregas.capabilityOffered?.(CAP_TODAS_LAS_TIENDAS, "manager")).toBe(true);
    expect(entregas.capabilitiesFromRole?.("manager")).not.toContain(CAP_TODAS_LAS_TIENDAS);
    expect(hasCap({ role: "manager" }, CAP_TODAS_LAS_TIENDAS)).toBe(false);
    expect(extraCaps({ role: "manager", permissions: [CAP_TODAS_LAS_TIENDAS] })).toEqual([CAP_TODAS_LAS_TIENDAS]);
  });
  it("a admin y logística se les enseña fija, del rol", () => {
    for (const r of ["admin", "logistics"] as const) {
      expect(entregas.capabilityOffered?.(CAP_TODAS_LAS_TIENDAS, r), r).toBe(true);
      expect(ROLE_CAPS[r], r).toContain(CAP_TODAS_LAS_TIENDAS);
    }
  });
  it("a ventas, oficina, almacén y chofer no se les dibuja, ni la traen del rol", () => {
    for (const r of ROLES_SIN_ELLA) {
      expect(entregas.capabilityOffered?.(CAP_TODAS_LAS_TIENDAS, r), r).toBe(false);
      expect(ROLE_CAPS[r], r).not.toContain(CAP_TODAS_LAS_TIENDAS);
    }
  });
  it("las demás capacidades de Entregas se siguen ofreciendo a todos los roles", () => {
    for (const c of CAPABILITIES.filter((x) => x.key !== CAP_TODAS_LAS_TIENDAS)) {
      for (const r of ["manager", "sales", "driver"]) expect(entregas.capabilityOffered?.(c.key, r), `${c.key}/${r}`).toBe(true);
    }
  });
});

describe("5 · los sitios que lo leen del servidor", () => {
  it("el informe de puntualidad lee también los permisos de quien pide (si no, Francis vería cero)", () => {
    const r = leer("src/app/api/puntualidad/route.ts");
    expect(r).toContain('.from("profiles").select("role, store, permissions").eq("id", user.id)');
  });
  it("el Panel le pasa el perfil entero a alcanceDelPanel, no un recorte sin permisos", () => {
    expect(leer("src/app/(app)/dashboard/page.tsx")).toContain("alcanceDelPanel(me, settings.stores)");
  });
});
