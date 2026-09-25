import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { alcanceDelPanel, choferesDelPanel, ordenesDelPanel, ROLES_PANEL_DE_TODAS } from "./panel-por-tienda";
import type { OrderTypeRules } from "./required";
import type { NamedLocation } from "./types";

/**
 * El Panel enseña solo las tiendas de quien mira (D-396).
 *
 * El dueño: «the Dashboard tab should only contain data of their own store, not all stores!!». Las
 * tiendas se llaman Norte, Sur y Oeste: los nombres reales son datos del dueño y viven en Ajustes.
 */

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const panel = leer("src/app/(app)/dashboard/page.tsx");
const atencion = leer("src/components/AttentionPanel.tsx");

/** Norte y Sur trabajan juntas (D-293); Oeste va sola. */
const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "100 Norte Ave", group: "G1" },
  { name: "Tienda Sur", address: "200 Sur Blvd", group: "G1" },
  { name: "Tienda Oeste", address: "300 Oeste Rd" },
];
const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any" },
};

type O = { id: string; store: string | null; pickup_name: string | null; delivery_name: string | null; order_type: string | null };
const o = (id: string, store: string | null, order_type = "Customer", delivery_name: string | null = "Casa", pickup_name: string | null = null): O =>
  ({ id, store, order_type, delivery_name, pickup_name });

// A propósito sin ordenar y con la de Oeste en medio: un filtro que devolviera un prefijo o la lista
// tal cual no pasaría.
const ORDENES: O[] = [
  o("oeste-1", "Tienda Oeste"),
  o("norte-1", "Tienda Norte"),
  o("oeste-2", "Tienda Oeste"),
  o("sur-1", "Tienda Sur"),
  // Intertienda que vende Oeste y RECIBE Norte: también es de Norte (D-309).
  o("inter-oeste-a-norte", "Tienda Oeste", "Intertienda", "Tienda Norte", "Tienda Oeste"),
  // Customer de Oeste que pone «Tienda Norte» como destino: en un Customer el destino no es una tienda.
  o("cliente-oeste-casa-norte", "Tienda Oeste", "Customer", "Tienda Norte"),
  o("sin-tienda", null),
];

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("alcanceDelPanel: de qué tiendas son las cifras", () => {
  it("admin y logística ven todas, tengan tienda o no", () => {
    expect([...ROLES_PANEL_DE_TODAS].sort()).toEqual(["admin", "logistics"]);
    expect(alcanceDelPanel({ role: "admin", store: null }, TIENDAS)).toEqual({ tipo: "todas" });
    expect(alcanceDelPanel({ role: "admin", store: "Tienda Oeste" }, TIENDAS)).toEqual({ tipo: "todas" });
    expect(alcanceDelPanel({ role: "logistics", store: "Tienda Oeste" }, TIENDAS)).toEqual({ tipo: "todas" });
  });

  it("el gerente: la suya y las de su grupo; la que va sola, solo ella", () => {
    const norte = alcanceDelPanel({ role: "manager", store: "Tienda Norte" }, TIENDAS);
    expect(norte.tipo).toBe("tiendas");
    if (norte.tipo !== "tiendas") return;
    expect([...norte.nombres].sort()).toEqual(["Tienda Norte", "Tienda Sur"]);
    expect([...norte.normalizadas].sort()).toEqual(["tienda norte", "tienda sur"]);
    const oeste = alcanceDelPanel({ role: "manager", store: " tienda oeste " }, TIENDAS);
    expect(oeste).toEqual({ tipo: "tiendas", nombres: ["Tienda Oeste"], normalizadas: ["tienda oeste"] });
  });

  it("el gerente sin tienda NO ve la empresa: se le avisa (D-237)", () => {
    expect(alcanceDelPanel({ role: "manager", store: null }, TIENDAS)).toEqual({ tipo: "sin-tienda" });
    expect(alcanceDelPanel({ role: "manager", store: "   " }, TIENDAS)).toEqual({ tipo: "sin-tienda" });
    expect(alcanceDelPanel(null, TIENDAS)).toEqual({ tipo: "sin-tienda" });
  });

  it("quien tiene la capacidad «dashboard» marcada a mano también va por su tienda", () => {
    expect(alcanceDelPanel({ role: "sales", store: "Tienda Oeste" }, TIENDAS).tipo).toBe("tiendas");
    expect(alcanceDelPanel({ role: "accounting", store: "Tienda Norte" }, TIENDAS).tipo).toBe("tiendas");
    expect(alcanceDelPanel({ role: "accounting", store: null }, TIENDAS)).toEqual({ tipo: "sin-tienda" });
  });
});

describe("ordenesDelPanel: las filas que cuentan", () => {
  it("gerente de Norte: Norte, Sur y la Intertienda que recibe; nada de Oeste", () => {
    const alcance = alcanceDelPanel({ role: "manager", store: "Tienda Norte" }, TIENDAS);
    expect(ids(ordenesDelPanel(ORDENES, alcance, REGLAS))).toEqual(["inter-oeste-a-norte", "norte-1", "sur-1"]);
  });

  it("gerente de Oeste: las suyas, incluida la Intertienda que manda", () => {
    const alcance = alcanceDelPanel({ role: "manager", store: "Tienda Oeste" }, TIENDAS);
    expect(ids(ordenesDelPanel(ORDENES, alcance, REGLAS))).toEqual(["cliente-oeste-casa-norte", "inter-oeste-a-norte", "oeste-1", "oeste-2"]);
  });

  it("admin: todas, también la que no tiene tienda", () => {
    expect(ids(ordenesDelPanel(ORDENES, { tipo: "todas" }, REGLAS))).toEqual(ids(ORDENES));
  });

  it("sin tienda: ninguna", () => {
    expect(ordenesDelPanel(ORDENES, { tipo: "sin-tienda" }, REGLAS)).toEqual([]);
  });
});

describe("choferesDelPanel: el tiempo inactivo es de los choferes de sus tiendas", () => {
  const USERS = [
    { id: "d-norte", full_name: "Chofer Norte", store: "Tienda Norte" },
    { id: "d-oeste", full_name: "Chofer Oeste", store: "Tienda Oeste" },
    { id: "d-sur", full_name: "Chofer Sur", store: "tienda sur " },
    { id: "d-nada", full_name: "Chofer Suelto", store: null },
  ];

  it("gerente de Norte: los de Norte y Sur", () => {
    const r = choferesDelPanel(alcanceDelPanel({ role: "manager", store: "Tienda Norte" }, TIENDAS), USERS);
    expect(r && [...r.ids].sort()).toEqual(["d-norte", "d-sur"]);
    expect(r && [...r.nombres].sort()).toEqual(["Chofer Norte", "Chofer Sur"]);
  });

  it("admin: sin corte (null)", () => {
    expect(choferesDelPanel({ tipo: "todas" }, USERS)).toBeNull();
  });
});

describe("la pantalla usa el corte, en todas sus tarjetas", () => {
  it("el alcance sale de quien mira y de las tiendas de Ajustes", () => {
    expect(panel).toContain("alcanceDelPanel(me, settings.stores)");
    expect(panel).toContain("ordenesDelPanel(deliveries, alcance, settings.order_type_rules)");
  });

  it("KPIs, gráficas y tablas beben de la lista acotada", () => {
    expect(panel).toContain("const scoped = useMemo(() => inDateRange(delPanel, from, to), [delPanel, from, to]);");
    expect(panel).toContain("salesRepStatsThisMonth(delPanel, users)");
    expect(panel).toContain("<AttentionPanel deliveries={delPanel}");
  });

  it("los turnos del reloj van por los choferes de sus tiendas", () => {
    expect(panel).toContain("(!misChoferes || misChoferes.ids.has(s.driver_id))");
    expect(panel).toContain("misChoferes.nombres.has(d.assigned_driver)");
  });

  // El barrido: cada línea del Panel que nombra la lista SIN acotar está aquí, y ninguna más. Una
  // tarjeta nueva que leyera `deliveries` a secas volvería a enseñarle la empresa al gerente, y esta
  // prueba caería.
  it("ninguna tarjeta lee la lista sin acotar", () => {
    // Sin comentarios ni textos entre comillas, y sin `r.deliveries` ni el nombre de la prop `deliveries=`:
    // lo que queda es la variable.
    const lineas = panel.split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("//"))
      .filter((l) => /(^|[^.\w])deliveries\b(?!=)/.test(l.replace(/"[^"]*"/g, '""')));
    expect(lineas).toEqual([
      "const { me, users, deliveries, events, settings, shifts, ready, ensureDeliveriesSince } = useData();",
      "() => ordenesDelPanel(deliveries, alcance, settings.order_type_rules),",
      "[deliveries, alcance, settings.order_type_rules],",
      "? inDateRange(deliveries, from, to).filter((d) => !!d.assigned_driver && misChoferes.nombres.has(d.assigned_driver))",
      "}, [shifts, users, scoped, deliveries, misChoferes, from, to]);",
    ]);
  });

  it("el panel de «Requiere atención» ya no lee las órdenes por su cuenta", () => {
    expect(atencion).not.toMatch(/const \{[^}]*\bdeliveries\b[^}]*\} = useData\(\)/);
    expect(atencion).toContain("attentionItems(deliveries, undefined, proofRequired)");
  });

  it("sin tienda: aviso en vez de cifras", () => {
    expect(panel).toContain(': alcance.tipo === "sin-tienda" ? (');
    expect(panel).toContain("data-panel-sin-tienda");
  });
});
