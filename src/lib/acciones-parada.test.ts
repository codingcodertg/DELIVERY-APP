import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KIND_RECHAZADA, KIND_RETOMADA, KIND_SALTADA, accionesDeParada, avisosDeRechazo, etiquetaDeEventoDeParada,
  marcasDeParadas, notaDeRechazo, pastillaDeMarca, razonDeLaNota, razonDeRechazo,
} from "@/lib/acciones-parada";
import { siguienteParada } from "@/lib/avisos-cliente";
import type { Delivery } from "@/lib/types";

// El componente se pinta de verdad: lo que decide `accionesDeParada` tiene que llegar a la pantalla.
vi.mock("@/lib/data-provider", () => ({
  useData: () => ({ me: { id: "u1", role: "driver", full_name: "Chofer Uno" }, users: [], settings: {}, marcarParada: async () => true, pushNotifs: async () => {}, notify: () => {} }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/components/LeaveAtStore", () => ({ LeaveAtStore: () => createElement("span", { "data-dejar": "1" }) }));

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const HOY = "2026-10-06";
// 15:00Z = 10:00 en Texas, el mismo día.
const ev = (delivery_id: string, kind: string, created_at = "2026-10-06T15:00:00Z", note: string | null = null) => ({ delivery_id, kind, created_at, note });

describe("marcasDeParadas", () => {
  it("un salto de hoy marca la parada; uno de ayer no", () => {
    const m = marcasDeParadas([ev("a", KIND_SALTADA), ev("b", KIND_SALTADA, "2026-10-05T15:00:00Z")], HOY);
    expect(m.get("a")?.marca).toBe("saltada");
    expect(m.has("b")).toBe(false);
  });
  it("retomar o mover la etapa borra el salto", () => {
    const m = marcasDeParadas([
      ev("a", KIND_SALTADA, "2026-10-06T15:00:00Z"), ev("a", KIND_RETOMADA, "2026-10-06T15:05:00Z"),
      ev("b", KIND_SALTADA, "2026-10-06T15:00:00Z"), ev("b", "picked_up", "2026-10-06T15:05:00Z"),
      ev("c", KIND_SALTADA, "2026-10-06T15:00:00Z"), ev("c", "note", "2026-10-06T15:05:00Z"),
    ], HOY);
    expect(m.has("a")).toBe(false);
    expect(m.has("b")).toBe(false);
    expect(m.get("c")?.marca).toBe("saltada");
  });
  it("el orden lo da la hora, no el orden de la lista (el proveedor la tiene al revés)", () => {
    const m = marcasDeParadas([ev("a", KIND_RETOMADA, "2026-10-06T15:05:00Z"), ev("a", KIND_SALTADA, "2026-10-06T15:00:00Z")], HOY);
    expect(m.has("a")).toBe(false);
  });
  it("el rechazo guarda la razón, no caduca con el día y sobrevive a «Dejar en tienda»", () => {
    const m = marcasDeParadas([
      ev("a", KIND_RECHAZADA, "2026-10-01T15:00:00Z", "Rejected by customer: Damaged material"),
      ev("a", "dropped_at_store", "2026-10-01T16:00:00Z"),
    ], HOY);
    expect(m.get("a")).toEqual({ marca: "rechazada", at: "2026-10-01T15:00:00Z", motivo: "Rejected by customer: Damaged material" });
  });
  it("volver a recogerla o entregarla borra el rechazo", () => {
    const m = marcasDeParadas([
      ev("a", KIND_RECHAZADA, "2026-10-06T15:00:00Z", "x"), ev("a", "picked_up", "2026-10-06T16:00:00Z"),
      ev("b", KIND_RECHAZADA, "2026-10-06T15:00:00Z", "x"), ev("b", "delivered", "2026-10-06T16:00:00Z"),
    ], HOY);
    expect(m.size).toBe(0);
  });
  it("el rechazo manda sobre un salto anterior", () => {
    const m = marcasDeParadas([ev("a", KIND_SALTADA, "2026-10-06T15:00:00Z"), ev("a", KIND_RECHAZADA, "2026-10-06T15:05:00Z", "n")], HOY);
    expect(m.get("a")?.marca).toBe("rechazada");
  });
  it("y sobre un salto posterior (otro teléfono, o un toque tardío): sigue rechazada", () => {
    const m = marcasDeParadas([ev("a", KIND_RECHAZADA, "2026-10-06T15:00:00Z", "n"), ev("a", KIND_SALTADA, "2026-10-06T15:05:00Z")], HOY);
    expect(m.get("a")?.marca).toBe("rechazada");
  });
});

describe("accionesDeParada", () => {
  const salto = { marca: "saltada" as const, at: "" };
  const rechazo = { marca: "rechazada" as const, at: "", motivo: "x" };
  it("recogida lista: Recogido y Saltar; saltada: Retomar", () => {
    expect(accionesDeParada("P", "ready", null)).toEqual(["recoger", "saltar"]);
    expect(accionesDeParada("P", "ready", salto)).toEqual(["recoger", "retomar"]);
  });
  it("recogida aún sin preparar: solo Saltar; ya en el camión: nada", () => {
    expect(accionesDeParada("P", "fulfilling", null)).toEqual(["saltar"]);
    expect(accionesDeParada("P", "picked_up", null)).toEqual([]);
  });
  it("entrega en el camión: Entregado, Saltar y Rechazado", () => {
    expect(accionesDeParada("D", "picked_up", null)).toEqual(["entregar", "saltar", "rechazar"]);
    expect(accionesDeParada("D", "picked_up", salto)).toEqual(["entregar", "retomar", "rechazar"]);
  });
  it("entrega sin recoger: solo Saltar (no se entrega ni se rechaza lo que no se cargó)", () => {
    expect(accionesDeParada("D", "ready", null)).toEqual(["saltar"]);
  });
  it("rechazada: solo Dejar en tienda, y solo con el material en el camión", () => {
    expect(accionesDeParada("D", "picked_up", rechazo)).toEqual(["dejar"]);
    expect(accionesDeParada("D", "ready", rechazo)).toEqual([]);
    expect(accionesDeParada("P", "picked_up", rechazo)).toEqual([]);
  });
  it("entregada o anulada: nada", () => {
    expect(accionesDeParada("D", "delivered", null)).toEqual([]);
    expect(accionesDeParada("P", "canceled", null)).toEqual([]);
  });
});

describe("siguienteParada con apartadas", () => {
  const r = [{ id: "a", stage: "picked_up" }, { id: "b", stage: "picked_up" }, { id: "c", stage: "ready" }];
  it("una saltada cede el turno", () => {
    expect(siguienteParada(r, marcasDeParadas([ev("a", KIND_SALTADA)], HOY))?.id).toBe("b");
  });
  it("solo quedan saltadas: vuelve la primera", () => {
    expect(siguienteParada(r, marcasDeParadas(["a", "b", "c"].map((id) => ev(id, KIND_SALTADA)), HOY))?.id).toBe("a");
  });
  it("una rechazada nunca es la siguiente", () => {
    expect(siguienteParada([r[0]], marcasDeParadas([ev("a", KIND_RECHAZADA, undefined, "n")], HOY))).toBeNull();
  });
  it("sin marcas, la regla de siempre", () => {
    expect(siguienteParada(r)?.id).toBe("a");
    expect(siguienteParada(r, new Map())?.id).toBe("a");
  });
});

describe("razonDeRechazo: la razón es obligatoria", () => {
  it("sin motivo ni texto, o con texto de menos: no hay razón", () => {
    expect(razonDeRechazo(null, "", "en")).toBeNull();
    expect(razonDeRechazo(null, " x ", "en")).toBeNull();
    expect(razonDeRechazo("other", "", "en")).toBeNull();
  });
  it("un motivo de un toque basta; con texto, va detrás", () => {
    expect(razonDeRechazo("damaged", "", "es")).toBe("Material dañado");
    expect(razonDeRechazo("damaged", "  roto   en dos ", "en")).toBe("Damaged material — roto en dos");
  });
  it("«Otro» o sin motivo: el texto es la razón", () => {
    expect(razonDeRechazo("other", "No firmó", "en")).toBe("No firmó");
    expect(razonDeRechazo(null, "Cerrado", "en")).toBe("Cerrado");
  });
  it("la nota lleva el prefijo y la pastilla lo quita", () => {
    const n = notaDeRechazo("Material dañado", "es");
    expect(n).toBe("Rechazada por el cliente: Material dañado");
    expect(razonDeLaNota(n)).toBe("Material dañado");
    expect(pastillaDeMarca({ marca: "rechazada", at: "", motivo: n }, "en")).toEqual({ texto: "Rejected", fondo: "var(--red-chip-bg)", tinta: "var(--red-chip-text)", detalle: "Material dañado" });
    expect(pastillaDeMarca({ marca: "saltada", at: "" }, "es")?.texto).toBe("Saltada");
    expect(pastillaDeMarca(null, "es")).toBeNull();
  });
});

describe("avisosDeRechazo", () => {
  it("a logística y admin, nunca a quien lo hizo", () => {
    const users = [{ id: "l", role: "logistics" }, { id: "a", role: "admin" }, { id: "s", role: "sales" }, { id: "yo", role: "admin" }];
    const s = avisosDeRechazo({ users, actorId: "yo", delivery_id: "d", order_no: 7, etiqueta: "#7", razon: "Cerrado", chofer: "Chofer Uno" });
    expect(s.map((x) => x.user_id)).toEqual(["l", "a"]);
    expect(s[0]).toMatchObject({ kind: KIND_RECHAZADA, message: "Order #7 was rejected by the customer (Chofer Uno): Cerrado" });
  });
});

describe("historial", () => {
  it("nombra los tres eventos y deja pasar los demás", () => {
    expect(etiquetaDeEventoDeParada(KIND_SALTADA, "es")).toBe("⏭ Parada saltada");
    expect(etiquetaDeEventoDeParada(KIND_RETOMADA, "en")).toBe("↩ Stop resumed");
    expect(etiquetaDeEventoDeParada(KIND_RECHAZADA, "en")).toBe("⛔ Rejected by customer");
    expect(etiquetaDeEventoDeParada("delivered", "en")).toBeNull();
  });
  it("la ficha y Auditoría usan la etiqueta", () => {
    expect(leer("src/components/OrderModal.tsx")).toMatch(/const deParada = etiquetaDeEventoDeParada\(kind, lang\);\s*if \(deParada\) return deParada;/);
    expect(leer("src/app/(app)/audit/page.tsx")).toMatch(/const deParada = etiquetaDeEventoDeParada\(kind, lang\);\s*if \(deParada\) return deParada;/);
  });
});

describe("pantalla: los botones llegan a cada parada", async () => {
  const { AccionesDeParada } = await import("@/components/AccionesDeParada");
  const pedido = (stage: string) => ({ id: "o1", stage, photos: [], order_no: 1, invoice_num: "INV1" }) as unknown as Delivery;
  const pinta = (tipo: "P" | "D", stage: string, marca: Parameters<typeof accionesDeParada>[2] = null, sinPrincipal = false) =>
    renderToStaticMarkup(createElement(AccionesDeParada, { pedido: pedido(stage), tipo, marca, guardando: false, cerrar: () => {}, sinPrincipal }));
  const acciones = (html: string) => [...html.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1]);

  it("entrega en el camión: Delivered, Skip, Rejected", () => {
    const html = pinta("D", "picked_up");
    expect(acciones(html)).toEqual(["entregar", "saltar", "rechazar"]);
    expect(html).toContain("Delivered");
    expect(html).toContain("Skip");
    expect(html).toContain("Rejected");
  });
  it("recogida lista: Picked up y Skip", () => {
    expect(acciones(pinta("P", "ready"))).toEqual(["recoger", "saltar"]);
  });
  it("saltada: dice que está saltada y ofrece Retomar", () => {
    const html = pinta("D", "picked_up", { marca: "saltada", at: "" });
    expect(html).toContain('data-marca-de-parada="saltada"');
    expect(acciones(html)).toEqual(["entregar", "retomar", "rechazar"]);
  });
  it("rechazada: la razón a la vista y Dejar en tienda", () => {
    const html = pinta("D", "picked_up", { marca: "rechazada", at: "", motivo: "Rejected by customer: Wrong material" });
    expect(html).toContain("Rejected by customer: Wrong material");
    expect(html).toContain('data-dejar="1"');
    expect(acciones(html)).toEqual([]);
  });
  it("en la tarjeta de Siguiente parada no repite el botón verde", () => {
    expect(acciones(pinta("D", "picked_up", null, true))).toEqual(["saltar", "rechazar"]);
  });
  it("«Mi ruta» pone los botones en recogidas, entregas y Siguiente parada, y la siguiente salta las apartadas", () => {
    const src = leer("src/app/(app)/my-route/page.tsx");
    expect(src).toContain("const marcas = useMemo(() => marcasDeParadas(events, todayISO()), [events]);");
    expect(src).toContain("const next = siguienteParada(stops, marcas);");
    expect(src).toContain('{d && accionesDe(d, "P")}');
    expect(src).toContain('{accionesDe(d, "D")}');
    expect(src).toContain('{accionesDe(next, next.stage === "picked_up" ? "D" : "P", true)}');
  });
  it("la pastilla dice la razón, y la ficha la lleva junto a la etapa", async () => {
    const { PastillaDeMarca } = await import("@/components/PastillaDeMarca");
    const html = renderToStaticMarkup(createElement(PastillaDeMarca, { m: { marca: "rechazada", at: "", motivo: "Rejected by customer: Cerrado" }, lang: "en" }));
    expect(html).toContain("Rejected: Cerrado");
    expect(renderToStaticMarkup(createElement(PastillaDeMarca, { m: undefined, lang: "en" }))).toBe("");
    expect(leer("src/components/OrderModal.tsx")).toContain("{existing && <PastillaDeMarca m={marcasDeParadas(events, todayISO()).get(existing.id)} lang={lang} />}");
  });
  it("Órdenes y el Gestor pintan la pastilla", () => {
    expect(leer("src/components/OrdersTable.tsx")).toContain("const ctx: Ctx = { lang, t, byInvoice, motivos: motivosDeAnulacion(settings), recibidas, marcas };");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("recibidas, marcas: marcasDeParada }");
  });
});
