import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkDelivery } from "@/lib/__fixtures";
import { cargaDe, cargasAlGuardar, COLUMNAS_PROPIAS_DE_LA_CARGA, etapaDeLaFamilia, hermanasDe, sePuedenJuntar, sePuedePartir } from "@/lib/cargas-partidas";
import { codeLabel } from "@/lib/order-code";
import { nombreDeLaOrden, orderLabel } from "@/lib/utils";
import { etiquetaDeOrden, facturaYId } from "@/lib/route-plan/etiqueta";
import { nombreEnElMapa } from "@/lib/gestor/nombre-en-el-mapa";
import { textoQueAbreLaOrden } from "@/lib/valores-del-gestor";
import { etiquetaDeLaOrden } from "@/lib/tomar-orden";
import { tratoDeOrden } from "@/lib/customers/tratos";
import { filasDeLaFoto } from "@/lib/foto-de-la-ruta";
import { coincideConLaBusqueda } from "@/lib/ordenes-visibles";
import { coincideConLaBusqueda as coincideEnElGestor } from "@/lib/ordenes-del-dia";
import { notificationsForStage } from "@/lib/notifications";
import { COLUMNAS_OPCIONALES_DE_LA_LISTA } from "@/lib/columnas-de-la-lista";
import type { Delivery, NamedLocation, Profile } from "@/lib/types";
import {
  alActivar, alDeshacer, avisosDeRelevo, entraEnElCamion, esPasoDeRelevo, estadoDelRelevo, etiquetaDeRelevo, mensajeDelRelevo, numeroConLetra,
  pasoAnterior, pasosDelRelevo, pasosParaVer, porQueNoSeActiva, porQueNoSeRecoge, primerDiaDelPasoB, problemaDelDiaDelPasoB, puedeGestionarRelevo,
  relevoParaElAviso, sePuedeDeshacer, textoDelEstado, textoDeRelevoParaBuscar, tiendasDeRelevo,
} from "./relevo";

/**
 * TRANSFERENCIA POR RELEVO (D-898, migración 256). El dueño, 2026-11-05: una intertienda McAllen → Brownsville que Julio
 * lleva de McAllen a Weslaco y, más tarde, Max de Weslaco a Brownsville; los pasos se llaman «Tr-1111-a» y «Tr-1111-b».
 *
 * Aquí: cómo se nombran (y que una carga partida de las de siempre sigue siendo «1111a»), qué se escribe al activar, la
 * regla del orden (el b no se recoge antes de que el a esté entregado), deshacer, quién puede, el estado de la orden
 * entera, los avisos al planificar, la búsqueda, y que el SQL de la 256 dice lo mismo.
 */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");
const t = (en: string, _es: string) => en;

const TIENDAS: NamedLocation[] = [
  { name: "RDZ McAllen", address: "1 Main St, McAllen, TX", lat: 26.2, lng: -98.23 },
  { name: "RDZ Weslaco", address: "2 Texas Blvd, Weslaco, TX", lat: 26.16, lng: -97.99 },
  { name: "RDZ Brownsville", address: "3 Boca Chica, Brownsville, TX", lat: 25.9, lng: -97.5 },
  { name: "RDZ Pharr", address: "4 Cage Blvd, Pharr, TX" },
];

/** La intertienda del ejemplo: McAllen → Brownsville, aprobada, 6 pallets. */
const intertienda = (over: Partial<Delivery> = {}): Delivery => mkDelivery({
  id: "madre", order_no: 1111, order_code: "FV111", order_type: "Intertienda", stage: "approved",
  store: "RDZ McAllen", pickup_name: "RDZ McAllen", pickup_address: "1 Main St, McAllen, TX",
  delivery_name: "RDZ Brownsville", delivery_address: "3 Boca Chica, Brownsville, TX", delivery_lat: 25.9, delivery_lng: -97.5, delivery_pin_source: "geocoded",
  delivery_date: "2026-11-06", est_pallets: 6, delivery_fee: 40, assigned_driver: "Julio Jijon", route_seq: 2, pickup_seq: 1.5, po2: "PO-9", invoice_num: "170059",
  ...over,
});

/** El relevo ya activado por Weslaco: [paso a, paso b]. */
function relevo(over: { a?: Partial<Delivery>; b?: Partial<Delivery>; fecha?: string } = {}): [Delivery, Delivery] {
  const madre = intertienda();
  const r = alActivar(madre, TIENDAS[1], over.fecha ?? "2026-11-06", { id: "paso-b", ahora: "2026-11-05T15:00:00.000Z", creador: "logi" })!;
  return [{ ...madre, ...r.madre, ...over.a }, { ...r.paso, ...over.b }];
}

describe("cómo se nombra: «Tr-1111-a» para un paso de relevo, «1111a» para una carga partida", () => {
  it("la regla de formato", () => {
    expect(etiquetaDeRelevo("1111", "a")).toBe("Tr-1111-a");
    expect(numeroConLetra("1111", { order_suffix: "b", relay_step: 2 })).toBe("Tr-1111-b");
    expect(numeroConLetra("1111", { order_suffix: "b", relay_step: null })).toBe("1111b");
    expect(numeroConLetra("1111", { order_suffix: "b" })).toBe("1111b");
    expect(numeroConLetra("1111", { order_suffix: null })).toBe("1111");
    // El dato admite más pasos: c, d.
    expect(numeroConLetra("1111", { order_suffix: "c", relay_step: 3 })).toBe("Tr-1111-c");
    expect(numeroConLetra("1111", { relay_step: 4 })).toBe("Tr-1111-d");
  });

  it("`orderLabel` y `codeLabel`, que son la base de todo lo que pinta un número de orden", () => {
    const [a, b] = relevo();
    expect(orderLabel(a)).toBe("Tr-FV111-a");
    expect(orderLabel(b)).toBe("Tr-FV111-b");
    expect(codeLabel(b)).toBe("Tr-FV111-b");
    expect(orderLabel({ order_no: 1111, order_code: null, order_suffix: "a", relay_step: 1 })).toBe("Tr-1111-a");
    // Una carga partida de las de siempre (D-452) NO cambia.
    expect(orderLabel({ order_no: 1111, order_code: "FV111", order_suffix: "a" })).toBe("FV111a");
    expect(orderLabel({ order_no: 1111, order_code: "FV111", order_suffix: "b", relay_step: null })).toBe("FV111b");
    expect(orderLabel({ order_no: 1111, order_code: "FV111", order_suffix: null })).toBe("FV111");
    expect(codeLabel({ order_code: "FV111", order_suffix: "a" })).toBe("FV111a");
  });

  it("donde lo que nombra la orden es la FACTURA (el Gestor, el mapa, «Mi ruta», la hoja de la ruta): «Tr-170059-a»", () => {
    const [a, b] = relevo();
    expect(facturaYId(a)).toEqual({ principal: "Tr-170059-a", id: "#Tr-FV111-a", esFactura: true });
    expect(facturaYId({ ...b, invoice_num: null })).toEqual({ principal: "#Tr-FV111-b", id: null, esFactura: false });
    expect(textoQueAbreLaOrden(b)).toEqual({ texto: "Tr-170059-b", esFactura: true });
    expect(nombreEnElMapa(a, t)).toBe("Tr-170059-a");
    expect(nombreEnElMapa({ ...a, invoice_num: null }, t)).toBe("#Tr-FV111-a (no invoice)");
    expect(nombreDeLaOrden(b)).toBe("Tr-170059-b");
    expect(etiquetaDeOrden(a, false)).toBe("#Tr-FV111-a · Inv. 170059");
    expect(filasDeLaFoto([a, b]).map((f) => f.orden)).toEqual(["Tr-170059-a", "Tr-170059-b"]);
    // Y las de siempre, igual que antes.
    const carga = mkDelivery({ order_no: 7, order_code: "FV007", order_suffix: "a", invoice_num: "555" });
    expect(facturaYId(carga)).toEqual({ principal: "555", id: "#FV007a", esFactura: true });
    expect(textoQueAbreLaOrden(carga)).toEqual({ texto: "555", esFactura: true });
    expect(nombreDeLaOrden(carga)).toBe("555");
    expect(nombreDeLaOrden({ ...carga, invoice_num: null })).toBe("#FV007a");
    expect(filasDeLaFoto([carga])[0].orden).toBe("555");
  });

  it("el chofer que toma una orden ajena y el historial del cliente también", () => {
    expect(etiquetaDeLaOrden({ order_no: 1111, order_suffix: "b", relay_step: 2, invoice_num: "170059" })).toBe("#Tr-1111-b · INV 170059");
    expect(etiquetaDeLaOrden({ order_no: 1111, order_suffix: "b", invoice_num: null })).toBe("#1111b");
    expect(tratoDeOrden({ id: "x", order_code: "FV111", order_suffix: "a", relay_step: 1 }).numero).toBe("Tr-FV111-a");
    expect(tratoDeOrden({ id: "x", order_code: "FV111", order_suffix: "a" }).numero).toBe("FV111a");
  });

  it("un paso de relevo NO es «carga 1 de 2»; dos cargas partidas lo siguen siendo", () => {
    const [a, b] = relevo();
    expect(cargaDe(a, hermanasDe([a, b], a))).toBeNull();
    const x = mkDelivery({ id: "x", order_no: 5, order_suffix: "a" }), y = mkDelivery({ id: "y", order_no: 5, order_suffix: "b" });
    expect(cargaDe(y, hermanasDe([x, y], y))).toEqual({ numero: 2, de: 2 });
  });
});

describe("activar: la orden pasa a ser el paso a y nace el paso b", () => {
  it("el ejemplo del dueño: McAllen → Weslaco (a) y Weslaco → Brownsville (b)", () => {
    const madre = intertienda();
    const r = alActivar(madre, TIENDAS[1], "2026-11-09", { id: "paso-b", ahora: "2026-11-05T15:00:00.000Z", creador: "logi" })!;
    // El paso a es la MISMA fila: conserva chofer, día, puesto, tarifa y pallets; solo cambia a dónde va.
    expect(r.madre).toMatchObject({ order_suffix: "a", relay_step: 1, delivery_name: "RDZ Weslaco", delivery_address: "2 Texas Blvd, Weslaco, TX", delivery_lat: 26.16, delivery_lng: -97.99, delivery_pin_source: "geocoded" });
    expect(Object.keys(r.madre)).not.toContain("assigned_driver");
    expect(Object.keys(r.madre)).not.toContain("delivery_date");
    // El paso b: de la tienda de relevo al destino FINAL, el día elegido, sin chofer ni puesto, listo, con TODOS los pallets.
    expect(r.paso).toMatchObject({
      id: "paso-b", order_no: 1111, order_code: "FV111", order_suffix: "b", relay_step: 2, stage: "ready",
      pickup_name: "RDZ Weslaco", pickup_address: "2 Texas Blvd, Weslaco, TX",
      delivery_name: "RDZ Brownsville", delivery_address: "3 Boca Chica, Brownsville, TX", delivery_lat: 25.9,
      delivery_date: "2026-11-09", assigned_driver: null, route_seq: null, pickup_seq: null,
      est_pallets: 6, store: "RDZ McAllen", po2: "PO-9", invoice_num: "170059", order_type: "Intertienda", created_by: "logi",
    });
    // La tarifa, solo en el paso a: ningún total la suma dos veces.
    expect(r.paso.delivery_fee).toBeNull();
    expect(r.paso.delivery_notes).toContain("Relay transfer Tr-FV111-b: RDZ Weslaco → RDZ Brownsville.");
  });

  it("una tienda sin punto verificado deja el destino sin punto (se geocodifica después), y la tienda tiene que ser OTRA", () => {
    const madre = intertienda();
    expect(alActivar(madre, TIENDAS[3], "2026-11-06", { id: "b", ahora: "x", creador: null })!.madre).toMatchObject({ delivery_lat: null, delivery_lng: null, delivery_pin_source: null });
    expect(alActivar(madre, TIENDAS[0], "2026-11-06", { id: "b", ahora: "x", creador: null })).toBeNull();   // el origen
    expect(alActivar(madre, TIENDAS[2], "2026-11-06", { id: "b", ahora: "x", creador: null })).toBeNull();   // el destino
    expect(tiendasDeRelevo(madre, TIENDAS).map((s) => s.name)).toEqual(["RDZ Weslaco", "RDZ Pharr"]);
  });

  it("qué orden lo admite: de tienda a tienda, aprobada, sin recoger, sin partir y sin relevo", () => {
    const d = intertienda();
    expect(porQueNoSeActiva(d, [d], TIENDAS)).toBeNull();
    expect(porQueNoSeActiva({ ...d, stage: "ready" }, [d], TIENDAS)).toBeNull();
    expect(porQueNoSeActiva({ ...d, order_type: "Transfer" }, [d], TIENDAS)).toBeNull();
    for (const stage of ["draft", "pending", "picked_up", "delivered", "canceled"] as const) expect(porQueNoSeActiva({ ...d, stage }, [d], TIENDAS)).toBe("etapa");
    expect(porQueNoSeActiva({ ...d, order_type: "Delivery" }, [d], TIENDAS)).toBe("no_es_tienda_a_tienda");
    expect(porQueNoSeActiva({ ...d, delivery_name: "A job site" }, [d], TIENDAS)).toBe("sin_tiendas");
    expect(porQueNoSeActiva({ ...d, order_suffix: "a" }, [d, mkDelivery({ id: "otra", order_no: 1111, order_suffix: "b" })], TIENDAS)).toBe("partida");
    const [a] = relevo();
    expect(porQueNoSeActiva(a, [a], TIENDAS)).toBe("ya_es_relevo");
  });

  it("el día del paso b: el mismo día que el a o cualquier día futuro; por defecto, el mismo", () => {
    expect(primerDiaDelPasoB("2026-11-06", "2026-11-05")).toBe("2026-11-06");
    expect(primerDiaDelPasoB("2026-11-01", "2026-11-05")).toBe("2026-11-05");   // el a va atrasado: desde hoy
    expect(primerDiaDelPasoB(null, "2026-11-05")).toBe("2026-11-05");
    expect(problemaDelDiaDelPasoB("2026-11-06", "2026-11-06", "2026-11-05")).toBeNull();
    expect(problemaDelDiaDelPasoB("2026-11-20", "2026-11-06", "2026-11-05")).toBeNull();
    expect(problemaDelDiaDelPasoB("2026-11-05", "2026-11-06", "2026-11-05")).toBe("antes");
    expect(problemaDelDiaDelPasoB("2026-11-04", null, "2026-11-05")).toBe("antes");
    expect(problemaDelDiaDelPasoB("2026-11-08", "2026-11-06", "2026-11-05")).toBe("domingo");
    expect(problemaDelDiaDelPasoB("", "2026-11-06", "2026-11-05")).toBe("falta");
  });
});

describe("la regla del orden: el paso b no se recoge antes de que el a esté entregado en la tienda de relevo", () => {
  it("bloquea con un mensaje claro mientras el a no esté entregado, y deja pasar cuando lo está", () => {
    for (const stage of ["approved", "fulfilling", "ready", "picked_up", "canceled"] as const) {
      const [a, b] = relevo({ a: { stage } });
      const no = porQueNoSeRecoge(b, [a, b]);
      expect(no?.en).toBe("Not yet: transfer step Tr-FV111-a has not been delivered at RDZ Weslaco. This step can only be picked up after that.");
      expect(no?.es).toContain("el paso Tr-FV111-a de la transferencia no se ha entregado en RDZ Weslaco");
    }
    const [a, b] = relevo({ a: { stage: "delivered" } });
    expect(porQueNoSeRecoge(b, [a, b])).toBeNull();
  });

  it("al paso a no le afecta, ni a una orden normal, ni a una carga partida", () => {
    const [a, b] = relevo();
    expect(porQueNoSeRecoge(a, [a, b])).toBeNull();
    const x = mkDelivery({ id: "x", order_no: 5, order_suffix: "a", stage: "ready" }), y = mkDelivery({ id: "y", order_no: 5, order_suffix: "b", stage: "ready" });
    expect(porQueNoSeRecoge(y, [x, y])).toBeNull();
    expect(pasoAnterior([a, b], b)?.id).toBe("madre");
    expect(pasoAnterior([a, b], a)).toBeNull();
  });

  it("un chofer no ve el paso de otro chofer: aquí no se decide (lo decide la base) y su error se dice en claro", () => {
    const [, b] = relevo();
    expect(porQueNoSeRecoge(b, [b])).toBeNull();
    expect(mensajeDelRelevo("RELEVO_ORDEN: this transfer step cannot be picked up before the previous step is delivered at the relay store (previous step: ready)", "es"))
      .toBe("Todavía no: el paso anterior de la transferencia no se ha entregado en la tienda de relevo. Este paso solo se puede recoger después.");
    expect(mensajeDelRelevo("RELEVO_ORDEN_DESHACER: the next transfer step was already picked up", "en")).toContain("can't be undone");
    expect(mensajeDelRelevo("RELEVO_FORBIDDEN: only route planners", "en")).toContain("Only route planners");
    expect(mensajeDelRelevo("driver cannot move an order from ready to delivered", "en")).toBeNull();
  });

  it("qué escrituras frena: entrar en recogido o entregado desde antes (también el «entregar ya» de oficina)", () => {
    expect(entraEnElCamion("ready", "picked_up")).toBe(true);
    expect(entraEnElCamion("approved", "delivered")).toBe(true);
    expect(entraEnElCamion("picked_up", "delivered")).toBe(false);   // ya pasó la regla al recoger
    expect(entraEnElCamion("delivered", "picked_up")).toBe(false);   // deshacer una entrega
    expect(entraEnElCamion("approved", "ready")).toBe(false);
  });

  it("los dos proveedores de datos la aplican antes de escribir la etapa", () => {
    for (const f of ["src/lib/data-provider.tsx", "src/lib/local-data-provider.tsx"]) {
      const codigo = leer(f);
      expect(codigo).toMatch(/entraEnElCamion\(\w+\.stage, stage\)/);
      expect(codigo).toContain("porQueNoSeRecoge(");
    }
    expect(leer("src/lib/data-provider.tsx")).toContain("mensajeDelRelevo(error.message, lang)");
  });
});

describe("deshacer el relevo, mientras el paso a no se haya recogido", () => {
  it("vuelve a ser UNA orden con su destino final; el otro paso se borra", () => {
    const [a, b] = relevo({ b: { assigned_driver: "Max", delivery_date: "2026-11-09" } });
    expect(sePuedeDeshacer([a, b])).toBe(true);
    const r = alDeshacer([a, b])!;
    expect(r.id).toBe("madre");
    expect(r.borrar).toEqual(["paso-b"]);
    expect(r.cambio).toMatchObject({ order_suffix: null, relay_step: null, delivery_name: "RDZ Brownsville", delivery_address: "3 Boca Chica, Brownsville, TX", delivery_lat: 25.9, delivery_lng: -97.5 });
    const vuelta = { ...a, ...r.cambio };
    expect(orderLabel(vuelta)).toBe("FV111");
    expect(esPasoDeRelevo(vuelta)).toBe(false);
    // Lo que era de la orden antes del relevo sigue ahí.
    expect(vuelta).toMatchObject({ assigned_driver: "Julio Jijon", delivery_date: "2026-11-06", est_pallets: 6, delivery_fee: 40 });
  });

  it("con el paso a ya recogido (o entregado) no se deshace", () => {
    for (const stage of ["picked_up", "delivered"] as const) {
      const [a, b] = relevo({ a: { stage } });
      expect(sePuedeDeshacer([a, b])).toBe(false);
      expect(alDeshacer([a, b])).toBeNull();
    }
    const [a] = relevo();
    expect(sePuedeDeshacer([a])).toBe(false);   // sin el otro paso a la vista no hay qué deshacer
  });
});

describe("quién puede: quien planifica rutas (y un admin)", () => {
  it("el mismo permiso que el Gestor de Rutas (`route_plan`)", () => {
    expect(puedeGestionarRelevo({ role: "admin" })).toBe(true);
    expect(puedeGestionarRelevo({ role: "logistics" })).toBe(true);
    for (const role of ["sales", "driver", "warehouse", "manager", "accounting"] as const) expect(puedeGestionarRelevo({ role })).toBe(false);
    expect(puedeGestionarRelevo({ role: "manager", permissions: ["route_plan"] })).toBe(true);
  });
});

describe("el estado de la orden ENTERA: entregada solo cuando lo está el último paso", () => {
  it("pendiente → en tránsito → entregada", () => {
    const en = (a: Delivery["stage"], b: Delivery["stage"]) => estadoDelRelevo(relevo({ a: { stage: a }, b: { stage: b } }));
    expect(en("approved", "ready")).toEqual({ etapa: "pendiente", entregados: 0, de: 2 });
    expect(en("picked_up", "ready")).toEqual({ etapa: "en_reparto", entregados: 0, de: 2 });
    // El paso a llegó a la tienda de relevo: la orden NO está entregada.
    expect(en("delivered", "ready")).toEqual({ etapa: "en_reparto", entregados: 1, de: 2 });
    expect(en("delivered", "picked_up")).toEqual({ etapa: "en_reparto", entregados: 1, de: 2 });
    expect(en("delivered", "delivered")).toEqual({ etapa: "entregada", entregados: 2, de: 2 });
    expect(textoDelEstado(en("delivered", "ready"), false)).toBe("In transit: 1 of 2 steps delivered");
    expect(textoDelEstado(en("delivered", "delivered"), true)).toBe("Orden entregada: todos los pasos llegaron");
    // Es la misma lectura de familia que las cargas partidas (D-452).
    expect(etapaDeLaFamilia(relevo({ a: { stage: "delivered" } }))).toBe("en_reparto");
  });

  it("la tarjeta enseña cada paso con quién y cuándo, del historial", () => {
    const [a, b] = relevo({ a: { stage: "delivered", pod_delivered_at: "2026-11-06T17:10:00.000Z" }, b: { assigned_driver: "Max" } });
    const eventos = [
      { delivery_id: "madre", kind: "picked_up", created_by: "u-julio", created_at: "2026-11-06T15:00:00.000Z" },
      { delivery_id: "madre", kind: "delivered", created_by: "u-julio", created_at: "2026-11-06T17:10:05.000Z" },
    ];
    const nombre = (id: string | null) => (id === "u-julio" ? "Julio Jijon" : null);
    const pasos = pasosParaVer(pasosDelRelevo([b, a], b), eventos, nombre);
    expect(pasos.map((p) => p.relay_step)).toEqual([1, 2]);
    expect(pasos[0]).toMatchObject({ stage: "delivered", pickup_name: "RDZ McAllen", delivery_name: "RDZ Weslaco", picked_up_by: "Julio Jijon", picked_up_at: "2026-11-06T15:00:00.000Z", delivered_by: "Julio Jijon", delivered_at: "2026-11-06T17:10:00.000Z" });
    expect(pasos[1]).toMatchObject({ stage: "ready", assigned_driver: "Max", pickup_name: "RDZ Weslaco", delivery_name: "RDZ Brownsville", picked_up_at: null, delivered_at: null });
  });

  it("el aviso de «entregada» de un paso que no es el último dice que la orden aún NO llegó", () => {
    const [a, b] = relevo();
    const usuarios = [{ id: "ventas", role: "sales", full_name: "V" }] as unknown as Profile[];
    const aviso = (d: Delivery) => notificationsForStage({ stage: "delivered", order_no: d.order_no, order_code: d.order_code, delivery_id: d.id, creatorId: "ventas", actorId: "chofer", users: usuarios, ...relevoParaElAviso(d, [a, b]) })[0].message;
    expect(aviso(a)).toBe("Transfer step #Tr-FV111-a reached the relay store — the order is not delivered yet, the next step is still to go");
    expect(aviso(b)).toBe("Transfer step #Tr-FV111-b was delivered — the order is complete");
    // Un chofer que solo ve su paso a: sigue sabiendo que queda otro.
    expect(relevoParaElAviso(a, [a])).toEqual({ etiqueta: "#Tr-FV111-a", faltanPasos: true });
    // Una orden normal, como siempre.
    const normal = mkDelivery({ order_no: 9, order_code: "FV009" });
    expect(relevoParaElAviso(normal, [normal])).toEqual({});
    expect(notificationsForStage({ stage: "delivered", order_no: 9, order_code: "FV009", delivery_id: "n", creatorId: "ventas", actorId: "chofer", users: usuarios })[0].message).toBe("Order #FV009 was delivered");
  });
});

describe("los avisos al planificar", () => {
  it("el paso b agendado ANTES que el a", () => {
    const [a, b] = relevo({ a: { delivery_date: "2026-11-10" }, b: { delivery_date: "2026-11-09" } });
    const avisos = avisosDeRelevo([a, b]);
    expect(avisos.map((x) => x.tipo)).toEqual(["b_antes_que_a"]);
    expect(avisos[0].en).toBe("Tr-FV111-b is scheduled for 2026-11-09, before Tr-FV111-a (2026-11-10): it can't be picked up until Tr-FV111-a is delivered.");
  });

  it("el mismo día en rutas distintas: se avisa (el motor no ordena una ruta respecto de otra)", () => {
    const [a, b] = relevo({ b: { assigned_driver: "Max" } });
    const avisos = avisosDeRelevo([a, b]);
    expect(avisos.map((x) => x.tipo)).toEqual(["mismo_dia_otra_ruta"]);
    expect(avisos[0].en).toContain("make sure Max reaches RDZ Weslaco after Julio Jijon drops it");
    expect(avisos[0].ids).toEqual(["madre", "paso-b"]);
  });

  it("el mismo día con el mismo chofer: solo si la recogida del b va delante de la entrega del a", () => {
    expect(avisosDeRelevo(relevo({ a: { route_seq: 3 }, b: { assigned_driver: "Julio Jijon", pickup_seq: 2.5, route_seq: 5 } })).map((x) => x.tipo)).toEqual(["mismo_chofer_al_reves"]);
    expect(avisosDeRelevo(relevo({ a: { route_seq: 3 }, b: { assigned_driver: "Julio Jijon", pickup_seq: 3.5, route_seq: 5 } }))).toEqual([]);
    // Sin puesto todavía en la lista (recién asignado): no se sabe, y se dice (medido en el demo: la lista provisional puso
    // la recogida del b delante de la del a).
    expect(avisosDeRelevo(relevo({ b: { assigned_driver: "Julio Jijon" } })).map((x) => x.tipo)).toEqual(["mismo_chofer_sin_orden"]);
  });

  it("nada que avisar: días distintos en orden, el b sin chofer, el a ya entregado, o sin relevos", () => {
    expect(avisosDeRelevo(relevo({ fecha: "2026-11-09", b: { assigned_driver: "Max" } }))).toEqual([]);
    expect(avisosDeRelevo(relevo())).toEqual([]);
    expect(avisosDeRelevo(relevo({ a: { stage: "delivered" }, b: { assigned_driver: "Max" } }))).toEqual([]);
    expect(avisosDeRelevo([mkDelivery({ order_suffix: "a" }), mkDelivery({ order_suffix: "b" })])).toEqual([]);
  });
});

describe("la búsqueda: «1111» encuentra los dos pasos; la etiqueta entera, el suyo", () => {
  it("en Órdenes y en las tablas del Gestor", () => {
    const [a, b] = relevo();
    for (const d of [a, b]) {
      expect(coincideConLaBusqueda(d, "1111")).toBe(true);
      expect(coincideConLaBusqueda(d, "FV111")).toBe(true);
      expect(coincideConLaBusqueda(d, "170059")).toBe(true);
      expect(coincideEnElGestor(d, "1111")).toBe(true);
      expect(coincideEnElGestor(d, "transfer")).toBe(true);
    }
    expect(coincideConLaBusqueda(a, "tr-fv111-a")).toBe(true);
    expect(coincideConLaBusqueda(b, "tr-fv111-a")).toBe(false);
    expect(coincideConLaBusqueda(b, "Tr-170059-b")).toBe(true);
    expect(coincideEnElGestor(b, "tr-1111-b")).toBe(true);
    expect(textoDeRelevoParaBuscar(mkDelivery({ order_suffix: "a" }))).toBe("");
  });
});

describe("las cargas partidas siguen como estaban, y un paso de relevo no entra en sus gestos", () => {
  it("✂ partir, ⤵ juntar y el partir solo al guardar no tocan un paso de relevo", () => {
    const [a, b] = relevo({ a: { est_pallets: 18 }, b: { est_pallets: 18 } });
    expect(sePuedePartir(a, 10)).toBe(false);
    expect(sePuedePartir({ ...a, relay_step: null }, 10)).toBe(true);
    expect(sePuedenJuntar({ ...a, est_pallets: 2 }, { ...b, est_pallets: 2, stage: "approved" }, 10)).toBe(false);
    expect(cargasAlGuardar({ ...a, assigned_driver: null }, { assigned_driver: "Julio Jijon" }, () => 10, "logistics")).toEqual([]);
    expect(cargasAlGuardar({ ...a, assigned_driver: null, relay_step: null }, { assigned_driver: "Julio Jijon" }, () => 10, "logistics")).toEqual([10, 8]);
  });
});

describe("la migración 256 dice lo mismo", () => {
  const sql = leer("supabase/migrations/256_transferencia_por_relevo.sql");
  const [cuerpo, registro] = sql.split("-- @ledger-below");
  const sinComentarios = cuerpo.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("su fila del registro está al día, sin begin/commit propios y sin el número de la decisión dentro", () => {
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('256_transferencia_por_relevo.sql', '${sha}') on conflict (name) do nothing;`);
    expect(sinComentarios).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(sql).not.toMatch(/D-898|D-\d{3}/);
  });

  it("una columna nueva y nada más: no reescribe el guard de etapas, ni políticas, ni las funciones de las cargas", () => {
    expect(sinComentarios).toContain("alter table public.deliveries add column if not exists relay_step smallint;");
    expect(sinComentarios).not.toMatch(/create (or replace )?function public\.(guard_delivery_stage|partir_carga|juntar_cargas|reparte_cargas|rutas_del_dia|publish_route_plan)\b/i);
    expect(sinComentarios).not.toMatch(/create policy|drop policy|alter policy|create table/i);
    // La lista la pide como columna opcional: el código sale antes de que se aplique la migración.
    expect(COLUMNAS_OPCIONALES_DE_LA_LISTA).toContain("relay_step");
  });

  it("la regla del orden vive en la base, para todos los roles", () => {
    expect(sinComentarios).toContain("create trigger deliveries_guard_relevo before insert or update or delete on public.deliveries");
    const guard = sinComentarios.slice(sinComentarios.indexOf("function public.guard_relevo()"), sinComentarios.indexOf("drop trigger if exists deliveries_guard_relevo"));
    expect(guard).toContain("security definer");                       // lee el paso de otro chofer
    expect(guard).toContain("NEW.relay_step > 1 and NEW.stage in ('picked_up', 'delivered') and OLD.stage not in ('picked_up', 'delivered')");
    expect(guard).toContain("if otro is distinct from 'delivered' then");
    expect(guard).toContain("RELEVO_ORDEN_DESHACER");
    expect(guard).not.toMatch(/current_user_role|'admin'/);            // sin salida para el admin: no es un permiso
  });

  it("quién puede: quien planifica rutas, y las funciones lo comprueban", () => {
    const puede = sinComentarios.slice(sinComentarios.indexOf("function public.puede_relevo()"), sinComentarios.indexOf("function public.relevo_norm"));
    expect(puede).toContain("public.has_deliveries_access()");
    expect(puede).toContain("p.role in ('admin', 'logistics') or 'route_plan' = any(coalesce(p.permissions, '{}'))");
    for (const f of ["activar_relevo(p_id uuid, p_tienda text, p_fecha date)", "deshacer_relevo(p_id uuid)"]) {
      const desde = sinComentarios.indexOf(`function public.${f}`);
      expect(sinComentarios.slice(desde, desde + 700)).toContain("if auth.uid() is null or not public.puede_relevo() then");
    }
    expect(sinComentarios).toContain("revoke execute on function public.activar_relevo(uuid, text, date) from public, anon;");
    expect(sinComentarios).toContain("revoke execute on function public.deshacer_relevo(uuid) from public, anon;");
  });

  it("activar escribe lo mismo que `alActivar`: la misma lista de columnas propias que una carga, más las del relevo", () => {
    const activar = sinComentarios.slice(sinComentarios.indexOf("function public.activar_relevo"), sinComentarios.indexOf("function public.deshacer_relevo"));
    expect(activar).toContain("madre.stage not in ('approved', 'fulfilling', 'ready')");
    expect(activar).toContain("p_fecha < greatest(hoy, coalesce(madre.delivery_date, hoy))");
    expect(activar).toContain("America/Chicago");
    // Cada pallet va en los dos pasos: ninguno de los dos campos se toca en el paso b.
    const propias = COLUMNAS_PROPIAS_DE_LA_CARGA.filter((c) => c !== "est_pallets" && c !== "actual_pallets");
    for (const c of propias) expect(activar, c).toContain(`'${c}',`);
    expect(activar).not.toMatch(/'est_pallets'|'actual_pallets'/);
    for (const c of ["relay_step", "stage", "pickup_name", "pickup_address", "delivery_date", "assigned_driver", "delivery_fee"]) expect(activar, c).toContain(`'${c}',`);
    // Lo mismo, medido en TypeScript: el paso b no arrastra nada «hecho» de la madre.
    const madre = intertienda({ pickup_gps_at: "x", pod_signature: "firma", photos: ["f"], departed_at: "x", csat_rating: 5 });
    const paso = alActivar(madre, TIENDAS[1], "2026-11-06", { id: "b", ahora: "x", creador: null })!.paso;
    expect(paso).toMatchObject({ pickup_gps_at: null, pod_signature: null, photos: null, departed_at: null, csat_rating: null });
  });

  it("deshacer solo mientras ningún paso haya salido, y por la función (un paso no se borra ni se parte por otro camino)", () => {
    const deshacer = sinComentarios.slice(sinComentarios.indexOf("function public.deshacer_relevo"), sinComentarios.indexOf("function public.pasos_del_relevo"));
    expect(deshacer).toContain("security definer");
    expect(deshacer).toContain("not public.la_ve_quien_llama(x)");
    expect(deshacer).toContain("RELEVO_YA_SALIO");
    expect(deshacer).toContain("d.stage in ('picked_up', 'delivered')");
    expect(deshacer).toContain("delivery_name       = ultimo.delivery_name");
    expect(sinComentarios).toContain("if OLD.relay_step is not null and marca <> OLD.order_no::text then");
    expect(sinComentarios).toContain("if NEW.relay_step is not null and marca <> NEW.order_no::text then");
  });
});
