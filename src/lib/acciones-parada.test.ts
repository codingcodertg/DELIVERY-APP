import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  KIND_LLEGO_A_ENTREGAR, KIND_LLEGO_A_RECOGER, KIND_RECHAZADA, KIND_RETOMADA, KIND_SALTADA, NO_ESTA_LISTA,
  accionesDeParada, avisosDeRechazo, etiquetaDeEventoDeParada, kindDeLlegada, llegadaDeLaParada, llegadasDeParadas,
  marcasDeParadas, notaDeRechazo, pastillaDeMarca, razonDeLaNota, razonDeRechazo,
} from "@/lib/acciones-parada";
import { siguienteParada } from "@/lib/avisos-cliente";
import type { Delivery } from "@/lib/types";

// **Nota D-NEXT (2026-10-11):** este fichero se rehízo con la decisión que quitó «Saltar» y añadió «📍 Llegué». Las pruebas
// del salto (que marcaba la parada, que «Retomar» la devolvía, que cedía el turno) se cambiaron por su contrario —un salto
// viejo ya no marca nada ni cede el turno—, y la tabla de botones por la nueva («Recogido» apagado con su motivo, sin
// «Saltar»). Las del rechazo (D-487, D-495) siguen igual.

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
  it("D-NEXT: un salto ya no marca nada, ni el de hoy, y «Retomar» tampoco", () => {
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

describe("llegadasDeParadas (D-NEXT)", () => {
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
});

describe("llegadaDeLaParada (D-NEXT)", () => {
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
    expect(llegadaDeLaParada({ tipo: "P", ordenes: ["a", "b"] }, etapaDe, sin, llegadas)).toEqual({ estado: "hecha", at: "2026-10-06T15:05:00Z" });
    // La de la tienda no cuenta como llegada con el cliente.
    expect(llegadaDeLaParada({ tipo: "D", ordenes: ["c"] }, etapaDe, sin, new Map([["c", { recoger: "x" }]]))?.estado).toBe("pendiente");
  });
  it("una rechazada no cuenta: ya llegó, y lo que toca es dejar el material", () => {
    const marcas = new Map([["c", { marca: "rechazada" as const, at: "", motivo: null }]]);
    expect(llegadaDeLaParada({ tipo: "D", ordenes: ["c", "e"] }, etapaDe, marcas, sin)).toEqual({ estado: "pendiente", tipo: "D", ordenes: ["e"] });
  });
  it("el evento de cada tramo", () => {
    expect(kindDeLlegada("P")).toBe(KIND_LLEGO_A_RECOGER);
    expect(kindDeLlegada("D")).toBe(KIND_LLEGO_A_ENTREGAR);
  });
});

describe("accionesDeParada", () => {
  const rechazo = { marca: "rechazada" as const, at: "", motivo: "x" };
  const acciones = (b: ReturnType<typeof accionesDeParada>) => b.map((x) => (x.apagado ? `${x.accion}(apagado)` : x.accion));
  it("recogida lista: Recogido, y nada de Saltar (D-NEXT)", () => {
    expect(acciones(accionesDeParada("P", "ready", null))).toEqual(["recoger"]);
  });
  it("recogida aún sin preparar: Recogido a la vista, apagado y con su motivo; ya en el camión: nada", () => {
    expect(accionesDeParada("P", "fulfilling", null)).toEqual([{ accion: "recoger", apagado: NO_ESTA_LISTA }]);
    expect(accionesDeParada("P", "approved", null)).toEqual([{ accion: "recoger", apagado: NO_ESTA_LISTA }]);
    expect(NO_ESTA_LISTA.es).toBe("El almacén aún no la tiene lista");
    expect(accionesDeParada("P", "picked_up", null)).toEqual([]);
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
  it("D-NEXT: un salto viejo ya no cede el turno", () => {
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
  const pinta = (tipo: "P" | "D", stage: string, marca: Parameters<typeof accionesDeParada>[2] = null, sinPrincipal = false) =>
    renderToStaticMarkup(createElement(AccionesDeParada, { pedido: pedido(stage), tipo, marca, guardando: false, cerrar: () => {}, sinPrincipal }));
  const acciones = (html: string) => [...html.matchAll(/data-accion="([a-z]+)"/g)].map((m) => m[1]);

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
  it("recogida que el almacén aún no tiene lista: Picked up a la vista, APAGADO, y el motivo escrito debajo", () => {
    const html = pinta("P", "fulfilling");
    expect(acciones(html)).toEqual(["recoger"]);
    expect(html).toMatch(/data-accion="recoger" data-apagado=""[^>]*disabled=""/);
    expect(html).toContain("⏳ The warehouse doesn&#x27;t have it ready yet");
  });
  it("rechazada: la razón a la vista y Dejar en tienda", () => {
    const html = pinta("D", "picked_up", { marca: "rechazada", at: "", motivo: "Rejected by customer: Wrong material" });
    expect(html).toContain("Rejected by customer: Wrong material");
    expect(html).toContain('data-dejar="1"');
    expect(acciones(html)).toEqual([]);
  });
  it("en la tarjeta de Siguiente parada no repite el botón verde", () => {
    expect(acciones(pinta("D", "picked_up", null, true))).toEqual(["rechazar"]);
    expect(acciones(pinta("P", "ready", null, true))).toEqual([]);
  });
  it("«Llegué»: el botón si falta, «✓ Arrived HH:MM» si ya llegó, nada si no hay a qué llegar; apagado al mirar la de otro", () => {
    const pendiente = renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "pendiente", tipo: "P", ordenes: ["o1"] } }));
    expect(acciones(pendiente)).toEqual(["llegue"]);
    expect(pendiente).toContain("📍 Arrived");
    expect(pendiente).not.toContain("disabled");
    const hecha = renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "hecha", at: "2026-10-06T15:42:00Z" } }));
    expect(acciones(hecha)).toEqual([]);
    expect(hecha).toMatch(/data-llegada="hecha"[^>]*>✓ Arrived.*\d/);
    expect(renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(BotonDeLlegada, { llegada: { estado: "pendiente", tipo: "D", ordenes: ["o1"] }, soloLectura: true }))).toContain("disabled");
  });
  it("«Llegué» deja un evento de llegada en cada orden de la parada", () => {
    const c = leer("src/components/AccionesDeParada.tsx");
    expect(c).toContain("for (const id of llegada.ordenes) todas = (await marcarParada(id, kindDeLlegada(llegada.tipo), null)) && todas;");
  });
  it("«Mi ruta»: Llegué por parada en la lista y en Siguiente parada, los botones en cada orden, y la siguiente sin las rechazadas", () => {
    const src = leer("src/app/(app)/my-route/page.tsx");
    expect(src).toContain("const marcas = useMemo(() => marcasDeParadas(events), [events]);");
    expect(src).toContain("const next = siguienteParada(stops, marcas);");
    expect(src).toContain("const llegadas = useMemo(() => llegadasDeParadas(events, todayISO()), [events]);");
    expect(src).toContain("const llegada = secciones.conNumero[fi] && !hechas.has(fi) ? llegadaDe(numeradas.deFila[fi]) : null;");
    expect(src.match(/<BotonDeLlegada llegada=\{llegada\} soloLectura=\{soloLectura\} \/>/g)).toHaveLength(2);
    expect(src).toContain("<BotonDeLlegada llegada={paradaDeLaSiguiente ? llegadaDeLaParada(paradaDeLaSiguiente, etapaDe, marcas, llegadas) : null} soloLectura={soloLectura} />");
    expect(src).toContain('const paradaDeLaSiguiente = next ? numeradas.paradas.find((p) => p.tipo === (next.stage === "picked_up" ? "D" : "P") && p.ordenes.includes(next.id)) : undefined;');
    expect(src).toContain('{d && accionesDe(d, "P")}');
    expect(src).toContain('{accionesDe(d, "D")}');
    expect(src).toContain('{accionesDe(next, next.stage === "picked_up" ? "D" : "P", true)}');
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
    expect(leer("src/components/OrdersTable.tsx")).toContain("const ctx: Ctx = { lang, t, byInvoice, motivos: motivosDeAnulacion(settings), recibidas, marcas };");
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
