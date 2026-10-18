import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KIND_LLEGO_A_ENTREGAR, KIND_LLEGO_A_RECOGER, KIND_RECHAZADA, KIND_RETOMADA, KIND_SALTADA, NO_ESTA_LISTA, SIN_APROBAR,
  accionesDeParada, avisosDeRechazo, etiquetaDeEventoDeParada, kindDeLlegada, llegadaDeLaParada, llegadasDeParadas,
  marcasDeParadas, notaDeRechazo, pastillaDeMarca, razonDeLaNota, razonDeRechazo,
  KIND_DESHIZO_LLEGADA_A_ENTREGAR, KIND_DESHIZO_LLEGADA_A_RECOGER, kindDeDeshacerLlegada, ordenDeLaLlegada,
  type LlegadaDeParada,
} from "@/lib/acciones-parada";
import { botonesConLlegada } from "@/lib/siguiente-de-mi-ruta";
import type { DeshacerRecogida } from "@/lib/recogida-del-chofer";
import { siguienteParada } from "@/lib/avisos-cliente";
import type { Delivery } from "@/lib/types";

// **Nota D-520 (2026-10-11):** este fichero se rehízo con la decisión que quitó «Saltar» y añadió «📍 Llegué». Las pruebas
// del salto (que marcaba la parada, que «Retomar» la devolvía, que cedía el turno) se cambiaron por su contrario —un salto
// viejo ya no marca nada ni cede el turno—, y la tabla de botones por la nueva («Recogido» apagado con su motivo, sin
// «Saltar»). Las del rechazo (D-487, D-495) siguen igual.
//
// **Nota D-527 (2026-10-11):** «Recogido» ya no se apaga por no estar lista (abre la ficha), «Llegué» va dentro de la fila
// de botones y se deshace, y la recogida hecha lleva «↩ Deshacer recogido». Cada prueba que cambió lo dice en su sitio.

// El componente se pinta de verdad: lo que decide `accionesDeParada` tiene que llegar a la pantalla.
vi.mock("@/lib/data-provider", () => ({
  useData: () => ({ me: { id: "u1", role: "driver", full_name: "Chofer Uno" }, users: [], settings: {}, marcarParada: async () => true, pushNotifs: async () => {}, notify: () => {} }),
}));
vi.mock("@/lib/prefs", () => ({ usePrefs: () => ({ t: (en: string) => en, lang: "en" }) }));
vi.mock("@/components/LeaveAtStore", () => ({ LeaveAtStore: () => createElement("span", { "data-dejar": "1" }) }));
// D-527: «↩ Deshacer» (la llegada y la recogida) pregunta con `useConfirm`, que en la app pone el layout.
vi.mock("@/lib/confirm", () => ({ useConfirm: () => async () => true }));

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const HOY = "2026-10-06";
// 15:00Z = 10:00 en Texas, el mismo día.
const ev = (delivery_id: string, kind: string, created_at = "2026-10-06T15:00:00Z", note: string | null = null) => ({ delivery_id, kind, created_at, note });

describe("marcasDeParadas", () => {
  it("D-520: un salto ya no marca nada, ni el de hoy, y «Retomar» tampoco", () => {
    const m = marcasDeParadas([ev("a", KIND_SALTADA), ev("b", KIND_SALTADA, "2026-10-06T15:00:00Z"), ev("b", KIND_RETOMADA, "2026-10-06T15:05:00Z")], HOY);
    expect(m.size).toBe(0);
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
  it("el orden lo da la hora, no el orden de la lista (el proveedor la tiene al revés)", () => {
    const m = marcasDeParadas([ev("a", KIND_RECHAZADA, "2026-10-06T16:00:00Z", "y"), ev("a", "picked_up", "2026-10-06T15:00:00Z")], HOY);
    expect(m.get("a")?.motivo).toBe("y");
  });
  it("un salto antes o después de un rechazo no lo cambia: sigue rechazada", () => {
    const m = marcasDeParadas([ev("a", KIND_SALTADA, "2026-10-06T15:00:00Z"), ev("a", KIND_RECHAZADA, "2026-10-06T15:05:00Z", "n"), ev("a", KIND_SALTADA, "2026-10-06T15:10:00Z")], HOY);
    expect(m.get("a")?.marca).toBe("rechazada");
  });
});

describe("llegadasDeParadas (D-520)", () => {
  it("la llegada de hoy cuenta; la de ayer no", () => {
    const m = llegadasDeParadas([ev("a", KIND_LLEGO_A_RECOGER), ev("b", KIND_LLEGO_A_RECOGER, "2026-10-05T15:00:00Z")], HOY);
    expect(m.get("a")).toEqual({ recoger: "2026-10-06T15:00:00Z" });
    expect(m.has("b")).toBe(false);
  });
  it("cada tramo la suya: en la tienda y con el cliente", () => {
    const m = llegadasDeParadas([ev("a", KIND_LLEGO_A_RECOGER, "2026-10-06T15:00:00Z"), ev("a", "picked_up", "2026-10-06T15:10:00Z"), ev("a", KIND_LLEGO_A_ENTREGAR, "2026-10-06T16:00:00Z")], HOY);
    expect(m.get("a")).toEqual({ recoger: "2026-10-06T15:00:00Z", entregar: "2026-10-06T16:00:00Z" });
  });
  it("recogerla borra la llegada con el cliente de antes (empieza otro tramo), no la de la tienda", () => {
    const m = llegadasDeParadas([ev("a", KIND_LLEGO_A_ENTREGAR, "2026-10-06T14:00:00Z"), ev("a", KIND_LLEGO_A_RECOGER, "2026-10-06T14:30:00Z"), ev("a", "picked_up", "2026-10-06T15:00:00Z")], HOY);
    expect(m.get("a")).toEqual({ recoger: "2026-10-06T14:30:00Z" });
  });
  it("«Dejar en tienda» y anularla borran las dos; que el almacén la marque lista no", () => {
    const m = llegadasDeParadas([
      ev("a", KIND_LLEGO_A_ENTREGAR, "2026-10-06T15:00:00Z"), ev("a", "dropped_at_store", "2026-10-06T15:30:00Z"),
      ev("b", KIND_LLEGO_A_RECOGER, "2026-10-06T15:00:00Z"), ev("b", "canceled", "2026-10-06T15:30:00Z"),
      ev("c", KIND_LLEGO_A_RECOGER, "2026-10-06T15:00:00Z"), ev("c", "ready", "2026-10-06T15:30:00Z"),
    ], HOY);
    expect(m.has("a")).toBe(false);
    expect(m.has("b")).toBe(false);
    expect(m.get("c")).toEqual({ recoger: "2026-10-06T15:00:00Z" });
  });
  it("el orden lo da la hora", () => {
    const m = llegadasDeParadas([ev("a", "picked_up", "2026-10-06T16:00:00Z"), ev("a", KIND_LLEGO_A_ENTREGAR, "2026-10-06T15:00:00Z")], HOY);
    expect(m.has("a")).toBe(false);
  });
  it("D-527: «↩ Deshacer» borra la llegada de SU tramo y no la del otro; una llegada después vuelve a contar", () => {
    const m = llegadasDeParadas([
      ev("a", KIND_LLEGO_A_RECOGER, "2026-10-06T14:00:00Z"), ev("a", KIND_DESHIZO_LLEGADA_A_RECOGER, "2026-10-06T14:05:00Z"),
      ev("b", KIND_LLEGO_A_RECOGER, "2026-10-06T14:00:00Z"), ev("b", "picked_up", "2026-10-06T14:10:00Z"),
      ev("b", KIND_LLEGO_A_ENTREGAR, "2026-10-06T15:00:00Z"), ev("b", KIND_DESHIZO_LLEGADA_A_ENTREGAR, "2026-10-06T15:01:00Z"),
      ev("c", KIND_LLEGO_A_RECOGER, "2026-10-06T14:00:00Z"), ev("c", KIND_DESHIZO_LLEGADA_A_RECOGER, "2026-10-06T14:05:00Z"),
      ev("c", KIND_LLEGO_A_RECOGER, "2026-10-06T14:20:00Z"),
    ], HOY);
    expect(m.has("a")).toBe(false);
    expect(m.get("b")).toEqual({ recoger: "2026-10-06T14:00:00Z" });
    expect(m.get("c")).toEqual({ recoger: "2026-10-06T14:20:00Z" });
    expect(kindDeDeshacerLlegada("P")).toBe("arrived_pickup_undone");
    expect(kindDeDeshacerLlegada("D")).toBe("arrived_delivery_undone");
  });
  it("D-527: deshacer la de la tienda no toca la del cliente (y al revés)", () => {
    const m = llegadasDeParadas([
      ev("a", KIND_LLEGO_A_RECOGER, "2026-10-06T14:00:00Z"), ev("a", "picked_up", "2026-10-06T14:10:00Z"),
      ev("a", KIND_LLEGO_A_ENTREGAR, "2026-10-06T15:00:00Z"), ev("a", KIND_DESHIZO_LLEGADA_A_RECOGER, "2026-10-06T15:05:00Z"),
    ], HOY);
    expect(m.get("a")).toEqual({ entregar: "2026-10-06T15:00:00Z" });
  });
});

describe("llegadaDeLaParada (D-520)", () => {
  const etapas: Record<string, string> = { a: "approved", b: "ready", c: "picked_up", d: "delivered", e: "picked_up" };
  const etapaDe = (id: string) => etapas[id];
  const sin = new Map();
  it("recogida: todas las que faltan por recoger, también las que no están listas", () => {
    expect(llegadaDeLaParada({ tipo: "P", ordenes: ["a", "b", "c"] }, etapaDe, sin, sin)).toEqual({ estado: "pendiente", tipo: "P", ordenes: ["a", "b"] });
  });
  it("entrega: solo lo que va en el camión", () => {
    expect(llegadaDeLaParada({ tipo: "D", ordenes: ["b", "c", "d"] }, etapaDe, sin, sin)).toEqual({ estado: "pendiente", tipo: "D", ordenes: ["c"] });
  });
  it("nada en ese tramo: nada que marcar", () => {
    expect(llegadaDeLaParada({ tipo: "D", ordenes: ["a", "b", "d"] }, etapaDe, sin, sin)).toBeNull();
    expect(llegadaDeLaParada({ tipo: "P", ordenes: ["c", "d"] }, etapaDe, sin, sin)).toBeNull();
  });
  it("ya llegó: «hecha», con la primera hora, y no se repite", () => {
    const llegadas = new Map([["a", { recoger: "2026-10-06T15:10:00Z" }], ["b", { recoger: "2026-10-06T15:05:00Z" }]]);
    // Nota D-527: «hecha» lleva también el tramo y sus órdenes —en qué fila va el botón, y a cuáles deshace «↩ Deshacer»—.
    expect(llegadaDeLaParada({ tipo: "P", ordenes: ["a", "b"] }, etapaDe, sin, llegadas)).toEqual({ estado: "hecha", at: "2026-10-06T15:05:00Z", tipo: "P", ordenes: ["a", "b"], conLlegada: ["a", "b"] });
    // La de la tienda no cuenta como llegada con el cliente.
    expect(llegadaDeLaParada({ tipo: "D", ordenes: ["c"] }, etapaDe, sin, new Map([["c", { recoger: "x" }]]))?.estado).toBe("pendiente");
  });
  it("una rechazada no cuenta: ya llegó, y lo que toca es dejar el material", () => {
    const marcas = new Map([["c", { marca: "rechazada" as const, at: "", motivo: null }]]);
    expect(llegadaDeLaParada({ tipo: "D", ordenes: ["c", "e"] }, etapaDe, marcas, sin)).toEqual({ estado: "pendiente", tipo: "D", ordenes: ["e"] });
  });
  it("D-527: «Llegué» va en la fila de la PRIMERA orden del tramo; «↩ Deshacer» solo en las que tienen llegada", () => {
    // `c` ya va en el camión: el tramo de la tienda empieza en `a`, y ahí va el botón, junto a su «Recogido».
    const pendiente = llegadaDeLaParada({ tipo: "P", ordenes: ["c", "a", "b"] }, etapaDe, sin, sin);
    expect(ordenDeLaLlegada(pendiente)).toBe("a");
    // Una orden que se sumó a la parada después de llegar: va en el tramo, pero no se le «deshace» nada.
    const hecha = llegadaDeLaParada({ tipo: "P", ordenes: ["a", "b"] }, etapaDe, sin, new Map([["b", { recoger: "2026-10-06T15:05:00Z" }]]));
    expect(hecha).toEqual({ estado: "hecha", at: "2026-10-06T15:05:00Z", tipo: "P", ordenes: ["a", "b"], conLlegada: ["b"] });
    expect(ordenDeLaLlegada(hecha)).toBe("a");
    expect(ordenDeLaLlegada(null)).toBeNull();
  });
  it("el evento de cada tramo", () => {
    expect(kindDeLlegada("P")).toBe(KIND_LLEGO_A_RECOGER);
    expect(kindDeLlegada("D")).toBe(KIND_LLEGO_A_ENTREGAR);
  });
});

describe("accionesDeParada", () => {
  const rechazo = { marca: "rechazada" as const, at: "", motivo: "x" };
  const acciones = (b: ReturnType<typeof accionesDeParada>) => b.map((x) => (x.apagado ? `${x.accion}(apagado)` : x.accion));
  it("recogida lista: Recogido, y nada de Saltar (D-520)", () => {
    expect(acciones(accionesDeParada("P", "ready", null))).toEqual(["recoger"]);
  });
  // Nota D-527: decía «Recogido a la vista, apagado y con su motivo» en `approved`/`fulfilling` (D-520). El dueño, 2026-10-11:
  // «have the driver be able to override a pickup even if the warheouse doesnt have it ready just put a note down for it».
  // Ahora sale encendido (abre la ficha, donde se recoge de todos modos con nota) y solo se apaga si no está aprobada.
  it("D-527: recogida aún sin preparar: Recogido ENCENDIDO (abre la ficha); sin aprobar, apagado con su motivo", () => {
    expect(accionesDeParada("P", "fulfilling", null)).toEqual([{ accion: "recoger", apagado: null }]);
    expect(accionesDeParada("P", "approved", null)).toEqual([{ accion: "recoger", apagado: null }]);
    expect(accionesDeParada("P", "pending", null)).toEqual([{ accion: "recoger", apagado: SIN_APROBAR }]);
    expect(accionesDeParada("P", "draft", null)).toEqual([{ accion: "recoger", apagado: SIN_APROBAR }]);
    expect(SIN_APROBAR.es).toBe("Aún no está aprobada");
    expect(NO_ESTA_LISTA.es).toBe("El almacén aún no la tiene lista");
  });
  it("D-527: ya en el camión: «↩ Deshacer recogido» si `deshacer` lo dice, apagado con su motivo si es un lío; si no, nada", () => {
    expect(accionesDeParada("P", "picked_up", null)).toEqual([]);
    expect(accionesDeParada("P", "picked_up", null, null)).toEqual([]);
    expect(accionesDeParada("P", "picked_up", null, { bloqueo: null })).toEqual([{ accion: "deshacer_recogida", apagado: null }]);
    const lio = { en: "ask the office", es: "pídeselo a la oficina" };
    expect(accionesDeParada("P", "picked_up", null, { bloqueo: lio })).toEqual([{ accion: "deshacer_recogida", apagado: lio }]);
    // Entregada o rechazada, nunca: lo de la rechazada es «Dejar en tienda».
    expect(accionesDeParada("P", "delivered", null, { bloqueo: null })).toEqual([]);
    expect(accionesDeParada("P", "picked_up", rechazo, { bloqueo: null })).toEqual([]);
    // Y en la entrega no: el deshacer va en la fila de la recogida.
    expect(acciones(accionesDeParada("D", "picked_up", null, { bloqueo: null }))).toEqual(["entregar", "rechazar"]);
  });
  it("entrega en el camión: Entregado y Rechazado (D-495)", () => {
    expect(acciones(accionesDeParada("D", "picked_up", null))).toEqual(["entregar", "rechazar"]);
  });
  it("entrega sin recoger: nada (no se entrega ni se rechaza lo que no se cargó; y ya no se salta)", () => {
    expect(accionesDeParada("D", "ready", null)).toEqual([]);
  });
  it("rechazada: solo Dejar en tienda, y solo con el material en el camión", () => {
    expect(acciones(accionesDeParada("D", "picked_up", rechazo))).toEqual(["dejar"]);
    expect(accionesDeParada("D", "ready", rechazo)).toEqual([]);
    expect(accionesDeParada("P", "ready", rechazo)).toEqual([]);
  });
  it("entregada o anulada: nada", () => {
    expect(accionesDeParada("D", "delivered", null)).toEqual([]);
    expect(accionesDeParada("P", "canceled", null)).toEqual([]);
  });
});

describe("siguienteParada con apartadas", () => {
  const r = [{ id: "a", stage: "picked_up" }, { id: "b", stage: "picked_up" }, { id: "c", stage: "ready" }];
  it("D-520: un salto viejo ya no cede el turno", () => {
    expect(siguienteParada(r, marcasDeParadas([ev("a", KIND_SALTADA)], HOY))?.id).toBe("a");
  });
  it("una rechazada nunca es la siguiente", () => {
    expect(siguienteParada(r, marcasDeParadas([ev("a", KIND_RECHAZADA, undefined, "n")], HOY))?.id).toBe("b");
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
  it("la nota lleva el prefijo y la pastilla lo quita; ya no hay pastilla «Saltada»", () => {
    const n = notaDeRechazo("Material dañado", "es");
    expect(n).toBe("Rechazada por el cliente: Material dañado");
    expect(razonDeLaNota(n)).toBe("Material dañado");
    expect(pastillaDeMarca({ marca: "rechazada", at: "", motivo: n }, "en")).toEqual({ texto: "Rejected", fondo: "var(--red-chip-bg)", tinta: "var(--red-chip-text)", detalle: "Material dañado" });
    expect(pastillaDeMarca(null, "es")).toBeNull();
    expect(pastillaDeMarca(marcasDeParadas([ev("a", KIND_SALTADA)], HOY).get("a"), "es")).toBeNull();
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
  it("nombra los eventos de parada —también los saltos viejos y las llegadas— y deja pasar los demás", () => {
    expect(etiquetaDeEventoDeParada(KIND_SALTADA, "es")).toBe("⏭ Parada saltada");
    expect(etiquetaDeEventoDeParada(KIND_RETOMADA, "en")).toBe("↩ Stop resumed");
    expect(etiquetaDeEventoDeParada(KIND_RECHAZADA, "en")).toBe("⛔ Rejected by customer");
    expect(etiquetaDeEventoDeParada(KIND_LLEGO_A_RECOGER, "es")).toBe("📍 Llegó a la tienda");
    expect(etiquetaDeEventoDeParada(KIND_LLEGO_A_ENTREGAR, "en")).toBe("📍 Arrived at the customer");
    expect(etiquetaDeEventoDeParada(KIND_DESHIZO_LLEGADA_A_RECOGER, "es")).toBe("↩ Llegada a la tienda deshecha");
    expect(etiquetaDeEventoDeParada(KIND_DESHIZO_LLEGADA_A_ENTREGAR, "en")).toBe("↩ Customer arrival undone");
    expect(etiquetaDeEventoDeParada("delivered", "en")).toBeNull();
  });
  it("la ficha y Auditoría usan la etiqueta", () => {
    expect(leer("src/components/OrderModal.tsx")).toMatch(/const deParada = etiquetaDeEventoDeParada\(kind, lang\);\s*if \(deParada\) return deParada;/);
    expect(leer("src/app/(app)/audit/page.tsx")).toMatch(/const deParada = etiquetaDeEventoDeParada\(kind, lang\);\s*if \(deParada\) return deParada;/);
  });
  it("la ficha da por llegado a quien marcó «Llegué» en «Mi ruta» (no le vuelve a ofrecer «Llegué a la parada»)", () => {
    expect(leer("src/components/OrderModal.tsx")).toContain("arrivedAt={arrivedAt ?? llegadasDeParadas(events, todayISO()).get(existing.id)?.entregar ?? null}");
  });
});

describe("pantalla: los botones llegan a cada parada", async () => {
  const { AccionesDeParada, BotonDeLlegada } = await import("@/components/AccionesDeParada");
  const pedido = (stage: string) => ({ id: "o1", stage, photos: [], order_no: 1, invoice_num: "INV1" }) as unknown as Delivery;
  // Nota D-527: sin `guardando` ni `sinPrincipal` (la tarjeta de «Siguiente parada» pinta los mismos botones que la lista,
  // y nada cierra la parada desde aquí: abren la ficha). Con `llegada` y `deshacer`.
  const pinta = (tipo: "P" | "D", stage: string, marca: Parameters<typeof accionesDeParada>[2] = null, extra: { llegada?: LlegadaDeParada | null; deshacer?: DeshacerRecogida; soloLectura?: boolean } = {}) =>
    renderToStaticMarkup(createElement(AccionesDeParada, { pedido: pedido(stage), tipo, marca, cerrar: () => {}, ...extra }));
  const acciones = (html: string) => [...html.matchAll(/data-accion="([a-z_]+)"/g)].map((m) => m[1]);

  it("entrega en el camión: solo Delivered y Rejected, sin Skip", () => {
    const html = pinta("D", "picked_up");
    expect(acciones(html)).toEqual(["entregar", "rechazar"]);
    expect(html).toContain("Delivered");
    expect(html).not.toContain("Skip");
    expect(html).toContain("Rejected");
  });
  it("recogida lista: Picked up, encendido, y sin Skip", () => {
    const html = pinta("P", "ready");
    expect(acciones(html)).toEqual(["recoger"]);
    expect(html).not.toContain("Skip");
    expect(html).not.toContain("disabled");
  });
  // Nota D-527: decía «APAGADO, y el motivo escrito debajo». Ahora encendido: abre la ficha, donde se recoge con nota.
  it("D-527: recogida que el almacén aún no tiene lista: Picked up ENCENDIDO; sin aprobar, apagado con «Not approved yet»", () => {
    const html = pinta("P", "fulfilling");
    expect(acciones(html)).toEqual(["recoger"]);
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("⏳");
    const pendiente = pinta("P", "pending");
    expect(pendiente).toMatch(/data-accion="recoger" data-apagado=""[^>]*disabled=""/);
    expect(pendiente).toContain("⏳ Not approved yet");
  });
  // Nota D-533: decía «Arrived · Picked up» y «Arrived · Delivered · Rejected», los dos a la vez. El dueño, 2026-10-12: «make
  // arrived first and then pickup not 2 button just 1 that changes» y «rejected will always show so 2 buttons for delivery».
  it("D-533: UN botón que cambia: «Arrived» mientras no se llega; «Picked up» / «Delivered» al llegar; «Rejected» siempre en la entrega", () => {
    const llegada: LlegadaDeParada = { estado: "pendiente", tipo: "P", ordenes: ["o1"] };
    const p = pinta("P", "ready", null, { llegada });
    expect(acciones(p)).toEqual(["llegue"]);
    const d = pinta("D", "picked_up", null, { llegada: { estado: "pendiente", tipo: "D", ordenes: ["o1"] } });
    expect(acciones(d.slice(d.indexOf("data-acciones-de-parada")))).toEqual(["llegue", "rechazar"]);
    // Ya llegó: el botón pasa a «Picked up» / «Delivered», y «✓ Arrived … ↩ Undo» baja a un renglón debajo de la fila.
    const pHecha = pinta("P", "ready", null, { llegada: { estado: "hecha", at: "2026-10-06T15:42:00Z", tipo: "P", ordenes: ["o1"], conLlegada: ["o1"] } });
    expect(acciones(pHecha)).toEqual(["recoger", "deshacer_llegada"]);
    const hecha = pinta("D", "picked_up", null, { llegada: { estado: "hecha", at: "2026-10-06T15:42:00Z", tipo: "D", ordenes: ["o1"], conLlegada: ["o1"] } });
    expect(acciones(hecha)).toEqual(["entregar", "rechazar", "deshacer_llegada"]);
    expect(hecha.indexOf("data-acciones-de-parada")).toBeLessThan(hecha.indexOf('data-llegada="hecha"'));
    // Sin llegada que marcar (la orden no está en el tramo de la parada): los botones de siempre.
    expect(acciones(pinta("D", "picked_up"))).toEqual(["entregar", "rechazar"]);
    expect(acciones(pinta("P", "ready"))).toEqual(["recoger"]);
    // La regla pura, aparte.
    expect(botonesConLlegada([{ accion: "recoger" }, { accion: "entregar" }, { accion: "rechazar" }, { accion: "dejar" }, { accion: "deshacer_recogida" }], llegada).map((b) => b.accion)).toEqual(["rechazar", "dejar", "deshacer_recogida"]);
    expect(botonesConLlegada([{ accion: "recoger" }], null).map((b) => b.accion)).toEqual(["recoger"]);
    expect(botonesConLlegada([{ accion: "entregar" }], { estado: "hecha", at: "x", tipo: "D", ordenes: ["o1"], conLlegada: ["o1"] }).map((b) => b.accion)).toEqual(["entregar"]);
  });
  it("D-527: cada botón de la fila, icono arriba y palabra debajo, y nunca menos de 44 px de alto", () => {
    const html = pinta("D", "picked_up", null, { llegada: { estado: "pendiente", tipo: "D", ordenes: ["o1"] } });
    const botones = html.match(/<button[^>]*data-accion="[a-z_]+"[^>]*>/g) ?? [];
    expect(botones).toHaveLength(2);
    for (const b of botones) {
      expect(b).toMatch(/flex-direction:column/);
      expect(Number(/min-height:(\d+)px/.exec(b)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });
  it("D-527: la recogida ya en el camión lleva «↩ Undo pickup»; apagado y con el motivo si es un lío", () => {
    expect(acciones(pinta("P", "picked_up"))).toEqual([]);
    const si = pinta("P", "picked_up", null, { deshacer: { bloqueo: null } });
    expect(acciones(si)).toEqual(["deshacer_recogida"]);
    expect(si).toContain("Undo pickup");
    expect(si).not.toContain("disabled");
    const no = pinta("P", "picked_up", null, { deshacer: { bloqueo: { en: "Someone else marked this pickup — ask the office to undo it", es: "x" } } });
    expect(no).toMatch(/data-accion="deshacer_recogida" data-apagado=""[^>]*disabled=""/);
    expect(no).toContain("Someone else marked this pickup — ask the office to undo it");
    // Y al mirar la ruta de otro (D-502), se ve igual y apagado.
    expect(pinta("P", "picked_up", null, { deshacer: { bloqueo: null }, soloLectura: true })).toMatch(/data-accion="deshacer_recogida"[^>]*disabled=""/);
  });
  it("D-527: deshacer la recogida pregunta, vuelve a `ready` con la escritura de `escrituraDeshacerRecogida`; deshacer la llegada deja su evento en las que la tenían", () => {
    const c = leer("src/components/AccionesDeParada.tsx");
    expect(c).toMatch(/const si = await confirmar\(\s*t\(`Undo the pickup of/);
    expect(c).toMatch(/const si = await confirmar\(\s*t\(`Undo your \$\{hora\(llegada\.at\)\} arrival\?/);
    expect(c.match(/if \(!si\) return;/g)).toHaveLength(2);
    expect(c).toContain("const { patch, note } = escrituraDeshacerRecogida(t);");
    expect(c).toContain('const hecho = await setStage(pedido.id, "ready", note, patch);');
    expect(c).toContain("for (const id of llegada.conLlegada) todas = (await marcarParada(id, kindDeDeshacerLlegada(llegada.tipo), null)) && todas;");
    expect(c).toMatch(/onClick=\{\(\) => cerrar\(pedido, a\)\}/);
  });
  it("rechazada: la razón a la vista y Dejar en tienda", () => {
    const html = pinta("D", "picked_up", { marca: "rechazada", at: "", motivo: "Rejected by customer: Wrong material" });
    expect(html).toContain("Rejected by customer: Wrong material");
    expect(html).toContain('data-dejar="1"');
    expect(acciones(html)).toEqual([]);
  });
  // Nota D-527: aquí estaba «en la tarjeta de Siguiente parada no repite el botón verde» (`sinPrincipal`). La tarjeta ya no
  // tiene su propio verde: pinta la misma fila que la lista («Llegué · Recogido», «Llegué · Entregado · Rechazado»).
  // Nota D-527: «✓ Arrived HH:MM» ya no es un texto: es el botón «↩ Undo» de la llegada, en el sitio de «Llegué».
  it("«Llegué»: el botón si falta, «✓ Arrived HH:MM ↩ Undo» si ya llegó, nada si no hay a qué llegar; apagado al mirar la de otro", () => {
    const pendiente = renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "pendiente", tipo: "P", ordenes: ["o1"] } }));
    expect(acciones(pendiente)).toEqual(["llegue"]);
    expect(pendiente).toContain("📍");
    expect(pendiente).toContain("Arrived");
    expect(pendiente).not.toContain("disabled");
    const hecha = renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "hecha", at: "2026-10-06T15:42:00Z", tipo: "P", ordenes: ["o1"], conLlegada: ["o1"] } }));
    expect(acciones(hecha)).toEqual(["deshacer_llegada"]);
    expect(hecha).toMatch(/data-llegada="hecha"[^>]*><span[^>]*>✓ Arrived.*\d/);
    expect(hecha).toContain("↩ Undo");
    expect(hecha).not.toContain("disabled");
    // D-533: ya no es un botón grande de la fila: un renglón pequeño con el «↩ Undo» como enlace.
    expect(hecha).toMatch(/^<span data-llegada="hecha" class="hint"/);
    expect(hecha).not.toContain("flex-direction:column");
    expect(renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "pendiente", tipo: "D", ordenes: ["o1"] }, soloLectura: true }))).toContain("disabled");
    expect(renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "hecha", at: "2026-10-06T15:42:00Z", tipo: "P", ordenes: ["o1"], conLlegada: ["o1"] }, soloLectura: true }))).toMatch(/data-accion="deshacer_llegada"[^>]*disabled=""/);
  });
  it("«Llegué» deja un evento de llegada en cada orden de la parada", () => {
    const c = leer("src/components/AccionesDeParada.tsx");
    expect(c).toContain("for (const id of llegada.ordenes) todas = (await marcarParada(id, kindDeLlegada(llegada.tipo), null)) && todas;");
  });
  // Nota D-527: «Llegué» ya no es un `<BotonDeLlegada>` suelto en la fila ni en la tarjeta: viaja dentro de los botones de
  // la orden que lo lleva (`llegadaSiEsDe`, la primera del tramo), y la tarjeta pinta la misma fila.
  it("«Mi ruta»: Llegué por parada en la lista y en Siguiente parada, los botones en cada orden, y la siguiente sin las rechazadas", () => {
    const src = leer("src/app/(app)/my-route/page.tsx");
    expect(src).toContain("const marcas = useMemo(() => marcasDeParadas(events), [events]);");
    // D-533: la siguiente sigue la ruta por paradas (`siguienteDeMiRuta`); `siguienteParada` queda de respaldo.
    expect(src).toContain("const sig = siguienteDeMiRuta(lectura.filas, numeradas, etapaDe, marcas);");
    expect(src).toContain("const next = sig ? (porId.get(sig.id) ?? null) : siguienteParada(stops, marcas);");
    expect(src).toContain("const llegadas = useMemo(() => llegadasDeParadas(events, todayISO()), [events]);");
    expect(src).toContain("const llegada = llegadaDe(numeradas.deFila[fi]);");
    // D-533: la llegada va en la fila de CADA orden del tramo (antes, solo en la primera: `ordenDeLaLlegada`).
    expect(src).toContain("const llegadaSiEsDe = (llegada: LlegadaDeParada | null, id: string) => llegadaDeLaOrden(llegada, id);");
    expect(src).not.toContain("<BotonDeLlegada");
    expect(src).toContain("const paradaDeLaSiguiente = sig ? numeradas.paradas[sig.parada - 1] : next ? numeradas.paradas.find((p) => p.tipo === tipoDeLaSiguiente && p.ordenes.includes(next.id)) : undefined;");
    // Nota D-547: cada fila recibe aún la llegada de su parada (esconde o enseña su «Recogido»/«Entregado»), pero el botón
    // «Llegué» solo lo pinta la primera orden del tramo (`llevaBotonDeLlegada`, el cuarto argumento).
    expect(src).toContain('{d && accionesDe(d, "P", llegadaSiEsDe(llegada, id), llevaBotonDeLlegada(llegada, id))}');
    expect(src).toContain('{accionesDe(d, "D", llegadaSiEsDe(llegada, d.id), llevaBotonDeLlegada(llegada, d.id))}');
    expect(src).toContain("{accionesDe(next, tipoDeLaSiguiente, paradaDeLaSiguiente ? llegadaDeLaOrden(llegadaDeLaParada(paradaDeLaSiguiente, etapaDe, marcas, llegadas), next.id) : null)}");
    expect(src).not.toContain("Skip");
  });
  it("la pastilla dice la razón, y la ficha la lleva junto a la etapa", async () => {
    const { PastillaDeMarca } = await import("@/components/PastillaDeMarca");
    const html = renderToStaticMarkup(createElement(PastillaDeMarca, { m: { marca: "rechazada", at: "", motivo: "Rejected by customer: Cerrado" }, lang: "en" }));
    expect(html).toContain("Rejected: Cerrado");
    expect(renderToStaticMarkup(createElement(PastillaDeMarca, { m: undefined, lang: "en" }))).toBe("");
    expect(leer("src/components/OrderModal.tsx")).toContain("{existing && <PastillaDeMarca m={marcasDeParadas(events, todayISO()).get(existing.id)} lang={lang} />}");
  });
  it("Órdenes y el Gestor pintan la pastilla", () => {
    // Nota D-573 (2026-10-16): el contexto lleva también `celdaDeEtapa`, la burbuja-selector de Almacén.
    // Nota D-577 (2026-10-18): y `me`, quien mira, para la cámara de «Delivered 📷».
    expect(leer("src/components/OrdersTable.tsx")).toContain("const ctx: Ctx = { lang, t, byInvoice, motivos: motivosDeAnulacion(settings), recibidas, marcas, accion: accionDeFila, celdaDeEtapa, me };");
    expect(leer("src/app/(app)/routes/page.tsx")).toContain("recibidas, marcas: marcasDeParada }");
  });
});

describe("D-495 · rechazo: qué pasó y a dónde va el material", () => {
  it("la tienda del destino: origen = `store` del pedido; otra = la elegida; sin elegir o inexistente, nada", async () => {
    const { tiendaDelRechazo, notaDelDestino } = await import("./acciones-parada");
    const tiendas = [{ name: "RDZ Pharr" }, { name: "RDZ McAllen" }];
    expect(tiendaDelRechazo({ tipo: "origen" }, "rdz pharr ", tiendas)?.name).toBe("RDZ Pharr");
    expect(tiendaDelRechazo({ tipo: "tienda", nombre: "RDZ McAllen" }, "RDZ Pharr", tiendas)?.name).toBe("RDZ McAllen");
    expect(tiendaDelRechazo(null, "RDZ Pharr", tiendas)).toBeNull();
    expect(tiendaDelRechazo({ tipo: "origen" }, null, tiendas)).toBeNull();
    expect(tiendaDelRechazo({ tipo: "tienda", nombre: "Otra" }, "RDZ Pharr", tiendas)).toBeNull();
    expect(notaDelDestino({ tipo: "origen" }, "RDZ Pharr", "es")).toBe("Lo regresa a RDZ Pharr");
    expect(notaDelDestino({ tipo: "tienda", nombre: "RDZ McAllen" }, "RDZ McAllen", "en")).toBe("Leaving it at RDZ McAllen");
  });
  it("la pantalla pregunta el destino, no confirma sin él, y al confirmar deja el material en la tienda", async () => {
    const { readFileSync } = await import("node:fs");
    const c = readFileSync("src/components/AccionesDeParada.tsx", "utf8");
    expect(c).toContain("data-destino-rechazo");
    expect(c).toContain("disabled={!razon || !destinoListo || ocupado}");
    expect(c).toContain('const dejado = await setStage(pedido.id, "ready", note, patch, EVENTO_DEJADO);');
  });
});
