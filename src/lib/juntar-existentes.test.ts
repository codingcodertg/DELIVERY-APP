import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { faltaParaAnular, MOTIVOS_SEMBRADOS } from "./cancel-reasons";
import {
  anulacionAlJuntar, avisoTrasJuntar, deshacerAlJuntar, ETAPAS_EN_LAS_QUE_SE_JUNTA, facturaNuevaAlEditar, juntarExistentes,
  notaAlJuntar, ofreceJuntarExistente, porQueNoPuedeJuntar, quienSeQueda, type EscriturasDeJuntar,
} from "./juntar-intertienda";
import type { Delivery } from "./types";

/**
 * D-557 (2026-10-15). El dueño aprobó («si a todo»): «when an invoice is put on an Intertienda that already has an open
 * Intertienda with the same invoice, offer "Juntar en #X": that order gets CANCELED with reason "Juntada en #X", and its PO
 * and pallets move to #X». El caso de su chat: la tienda B escribe la MISMA factura en tres órdenes que la tienda A ya creó.
 */

const leer = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

const REGLAS = {
  Intertienda: { storeToStore: true, docRef: "po" as const, homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" as const },
};

const orden = (o: Partial<Delivery>): Delivery => ({
  id: "x", order_no: 1, stage: "approved", order_type: "Intertienda", store: "Pharr", delivery_name: "McAllen",
  invoice_num: null, invoices_extra: null, po2: "PO-1", est_pallets: 3, pickup_duration: "12 min", delivery_duration: "18 min",
  ...o,
} as unknown as Delivery);

const MINUTOS = { recoger: 4, entregar: 6 };

/** Un proveedor de datos falso: apunta cada llamada, en orden, y contesta lo que se le diga. */
function falso(resp: { update?: boolean[]; stage?: boolean } = {}) {
  const llamadas: Array<[string, ...unknown[]]> = [];
  const updates = [...(resp.update ?? [])];
  const esc: EscriturasDeJuntar = {
    updateDelivery: async (id, p) => { llamadas.push(["update", id, p]); return updates.length ? updates.shift()! : true; },
    addNote: async (id, t) => { llamadas.push(["nota", id, t]); },
    setStage: async (id, s, n, e) => { llamadas.push(["etapa", id, s, n, e]); return resp.stage ?? true; },
  };
  return { esc, llamadas };
}

describe("D-557 · cuándo se pregunta al escribir la factura en una orden que ya existe", () => {
  it("solo cuando la escritura AÑADE una factura que la orden no tenía (también en las agregadas)", () => {
    expect(facturaNuevaAlEditar({ invoice_num: null }, { invoice_num: " INV-100 " })).toBe("INV-100");
    expect(facturaNuevaAlEditar({ invoice_num: "INV-100" }, { invoice_num: "#inv-100" })).toBeNull();
    expect(facturaNuevaAlEditar({ invoice_num: null, invoices_extra: ["INV-100"] }, { invoice_num: "inv-100" })).toBeNull();
    // «Agregar material»: la nueva va en las agregadas.
    expect(facturaNuevaAlEditar({ invoice_num: "INV-1", invoices_extra: null }, { invoices_extra: ["INV-2"] })).toBe("INV-2");
    expect(facturaNuevaAlEditar({ invoice_num: "INV-1" }, { invoice_num: "INV-1", invoices_extra: ["  "] })).toBeNull();
    expect(facturaNuevaAlEditar({ invoice_num: null }, { invoice_num: "" })).toBeNull();
  });

  it("encuentra la OTRA Intertienda abierta con esa factura; la propia orden no cuenta", () => {
    const yo = orden({ id: "yo", order_no: 7 });
    const otra = orden({ id: "otra", order_no: 5, invoice_num: "INV-100" });
    expect(ofreceJuntarExistente(yo, "inv-100", [yo, otra], REGLAS)?.id).toBe("otra");
    // La propia, aunque ya tenga la factura en la lista, no es «la otra».
    const yoConFactura = orden({ id: "yo", invoice_num: "INV-100" });
    expect(ofreceJuntarExistente(yoConFactura, "INV-100", [yoConFactura], REGLAS)).toBeNull();
    // Las reglas de D-549 siguen: otra tienda que vende u otro tipo no juntan.
    expect(ofreceJuntarExistente(yo, "INV-100", [orden({ id: "o", invoice_num: "INV-100", store: "Weslaco" })], REGLAS)).toBeNull();
    expect(ofreceJuntarExistente({ ...yo, order_type: "Transfer" }, "INV-100", [otra], REGLAS)).toBeNull();
  });

  it("una orden propia que ya no está abierta no se junta con nada", () => {
    const otra = orden({ id: "otra", invoice_num: "INV-100" });
    for (const stage of ["picked_up", "delivered", "canceled", "rejected"]) {
      expect([stage, ofreceJuntarExistente(orden({ id: "yo", stage: stage as Delivery["stage"] }), "INV-100", [otra], REGLAS)]).toEqual([stage, null]);
    }
    for (const stage of ETAPAS_EN_LAS_QUE_SE_JUNTA) {
      expect([stage, ofreceJuntarExistente(orden({ id: "yo", stage: stage as Delivery["stage"] }), "INV-100", [otra], REGLAS)?.id]).toEqual([stage, "otra"]);
    }
  });
});

describe("D-557 · cuál se queda", () => {
  it("se queda la que va más adelante, aunque sea la más nueva", () => {
    const vieja = orden({ id: "v", order_no: 3, stage: "pending" });
    const nueva = orden({ id: "n", order_no: 9, stage: "fulfilling" });
    expect(quienSeQueda(vieja, nueva)).toEqual({ queda: nueva, anula: vieja });
    expect(quienSeQueda(nueva, vieja)).toEqual({ queda: nueva, anula: vieja });
  });

  it("en la misma etapa, se queda la más vieja (order_no más bajo), sin importar el orden de los argumentos", () => {
    const vieja = orden({ id: "z", order_no: 3, stage: "approved" });
    const nueva = orden({ id: "a", order_no: 9, stage: "approved" });
    expect(quienSeQueda(vieja, nueva).queda.id).toBe("z");
    expect(quienSeQueda(nueva, vieja).queda.id).toBe("z");
  });

  it("todo empatado: decide el id, el mismo resultado en los dos sentidos", () => {
    const a = orden({ id: "a", order_no: 4 });
    const b = orden({ id: "b", order_no: 4 });
    expect(quienSeQueda(a, b).queda.id).toBe("a");
    expect(quienSeQueda(b, a).queda.id).toBe("a");
  });
});

describe("D-557 · quién puede juntar dos que ya existen (las DOS escrituras)", () => {
  const ABIERTAS = ETAPAS_EN_LAS_QUE_SE_JUNTA;

  it("admin, gerente y oficina: en cualquier par de etapas abiertas", () => {
    for (const rol of ["admin", "manager", "accounting"]) for (const q of ABIERTAS) for (const a of ABIERTAS) {
      expect([rol, q, a, porQueNoPuedeJuntar(rol, q, a)]).toEqual([rol, q, a, null]);
    }
  });

  it("logística y almacén: nunca, porque el guard no les deja anular (lo que la escritura de la PO sí)", () => {
    for (const q of ABIERTAS) for (const a of ABIERTAS) {
      expect(["logistics", q, a, porQueNoPuedeJuntar("logistics", q, a)]).toEqual(["logistics", q, a, "anular"]);
      const almacen = ["approved", "fulfilling", "ready"].includes(q) ? "anular" : "editar";
      expect(["warehouse", q, a, porQueNoPuedeJuntar("warehouse", q, a)]).toEqual(["warehouse", q, a, almacen]);
    }
  });

  it("ventas y chofer: solo anulando un borrador y escribiendo en un borrador o una pendiente", () => {
    for (const rol of ["sales", "driver"]) for (const q of ABIERTAS) for (const a of ABIERTAS) {
      const esperado = !["draft", "pending"].includes(q) ? "editar" : a !== "draft" ? "anular" : null;
      expect([rol, q, a, porQueNoPuedeJuntar(rol, q, a)]).toEqual([rol, q, a, esperado]);
    }
  });

  it("con una de las dos cerrada, nadie (ni admin)", () => {
    for (const cerrada of ["picked_up", "delivered", "canceled", "rejected", null]) {
      expect(porQueNoPuedeJuntar("admin", cerrada, "approved")).toBe("etapa");
      expect(porQueNoPuedeJuntar("admin", "approved", cerrada)).toBe("etapa");
    }
    expect(porQueNoPuedeJuntar(null, "draft", "draft")).toBe("editar");
  });

  it("el guard de la 173 sigue sin dejar anular a logística ni a almacén (si cambia, esta regla se revisa)", () => {
    const sql = leer("supabase/migrations/173_reprogramar_orden.sql");
    const guard = sql.slice(sql.indexOf("create or replace function public.guard_delivery_stage()"), sql.indexOf("create or replace function public.reprogramar_orden("));
    expect(guard).toContain("if r in ('sales','driver','manager','accounting') then");
    expect(guard).toContain("or (r in ('manager','accounting') and new_stage = 'canceled' and old_stage in ('pending','approved','fulfilling','ready'))");
    const almacen = guard.slice(guard.indexOf("elsif r = 'warehouse' then"), guard.indexOf("raise exception 'Not allowed';"));
    expect(almacen.length).toBeGreaterThan(0);
    expect(almacen).not.toContain("canceled");
  });
});

describe("D-557 · qué se escribe y en qué orden", () => {
  it("el motivo: `other` con «Juntada en #X — misma factura #F», que el espejo del guard da por bueno", () => {
    const m = anulacionAlJuntar({ order_no: 41 }, " INV-100 ", "es");
    expect(m).toEqual({ canceled_reason: "other", canceled_reason_note: "Juntada en #41 — misma factura #INV-100" });
    expect(anulacionAlJuntar({ order_no: 41 }, "INV-100", "en").canceled_reason_note).toBe("Joined into #41 — same invoice #INV-100");
    expect(faltaParaAnular(m.canceled_reason, m.canceled_reason_note, MOTIVOS_SEMBRADOS, "es")).toBeNull();
  });

  it("la nota de la que se queda dice cuál se juntó: «Se juntó #Y (PO …, N pallets) — misma factura #F»", () => {
    expect(notaAlJuntar({ po2: "PO-2", est_pallets: 2, invoice_num: "INV-100" }, "es", "42")).toBe("Se juntó #42 (PO PO-2, 2 pallets) — misma factura #INV-100");
    expect(notaAlJuntar({ po2: null, est_pallets: null, invoice_num: "INV-100" }, "en", "42")).toBe("#42 joined (PO no PO, 0 pallets) — same invoice #INV-100");
  });

  it("se anula la que se estaba editando: primero la otra recibe PO y pallets, después la anulación lleva solo la factura", async () => {
    const otra = orden({ id: "otra", order_no: 5, invoice_num: "INV-100", po2: "PO-1", est_pallets: 3 });
    const yo = orden({ id: "yo", order_no: 9, po2: "PO-2", est_pallets: 2 });
    const { esc, llamadas } = falso();
    const r = await juntarExistentes(esc, { queda: otra, anula: yo, idPropia: "yo", propia: { invoice_num: "INV-100", contact: "Ana" }, factura: "INV-100", minutosPorPallet: MINUTOS, lang: "es" });
    expect(r).toBe("juntada");
    expect(llamadas).toEqual([
      ["update", "otra", { po2: "PO-1, PO-2", est_pallets: 5, pickup_duration: "20 min", delivery_duration: "30 min" }],
      ["nota", "otra", "Se juntó #9 (PO PO-2, 2 pallets) — misma factura #INV-100"],
      ["etapa", "yo", "canceled", "Juntada en #5 — misma factura #INV-100",
        { invoice_num: "INV-100", canceled_reason: "other", canceled_reason_note: "Juntada en #5 — misma factura #INV-100" }],
    ]);
  });

  it("se queda la que se estaba editando: su escritura viaja entera con el parche; la otra se anula sin tocarle la factura", async () => {
    const yo = orden({ id: "yo", order_no: 9, stage: "ready", po2: "PO-2", est_pallets: 2 });
    const otra = orden({ id: "otra", order_no: 5, stage: "approved", invoice_num: "INV-100", po2: "PO-1", est_pallets: 3 });
    const { esc, llamadas } = falso();
    const r = await juntarExistentes(esc, { queda: yo, anula: otra, idPropia: "yo", propia: { invoice_num: "INV-100", est_pallets: 4 }, factura: "INV-100", minutosPorPallet: MINUTOS, lang: "es" });
    expect(r).toBe("juntada");
    expect(llamadas[0]).toEqual(["update", "yo", { invoice_num: "INV-100", po2: "PO-2, PO-1", est_pallets: 7, pickup_duration: "28 min", delivery_duration: "42 min" }]);
    expect(llamadas[2]).toEqual(["etapa", "otra", "canceled", "Juntada en #9 — misma factura #INV-100",
      { canceled_reason: "other", canceled_reason_note: "Juntada en #9 — misma factura #INV-100" }]);
  });

  it("si la primera escritura falla, no se anula nada", async () => {
    const { esc, llamadas } = falso({ update: [false] });
    const r = await juntarExistentes(esc, { queda: orden({ id: "q" }), anula: orden({ id: "a", po2: "PO-9" }), idPropia: "a", propia: { invoice_num: "F" }, factura: "F", minutosPorPallet: MINUTOS, lang: "es" });
    expect(r).toBe("sin_escribir");
    expect(llamadas.map((l) => l[0])).toEqual(["update"]);
  });

  it("si la anulación falla, la que se queda vuelve a como estaba y lo dice su historial", async () => {
    const q = orden({ id: "q", order_no: 5, po2: "PO-1", est_pallets: 3, pickup_duration: "12 min", delivery_duration: "18 min" });
    const a = orden({ id: "a", order_no: 9, po2: "PO-2", est_pallets: 2 });
    const { esc, llamadas } = falso({ stage: false });
    const r = await juntarExistentes(esc, { queda: q, anula: a, idPropia: "a", propia: { invoice_num: "F" }, factura: "F", minutosPorPallet: MINUTOS, lang: "es" });
    expect(r).toBe("deshecha");
    expect(llamadas.map((l) => l[0])).toEqual(["update", "nota", "etapa", "update", "nota"]);
    expect(llamadas[3]).toEqual(["update", "q", { po2: "PO-1", est_pallets: 3, pickup_duration: "12 min", delivery_duration: "18 min" }]);
    expect(llamadas[4]).toEqual(["nota", "q", "No se pudo anular #9: se deshizo lo que se le había sumado de ella"]);
  });

  it("si la anulación falla y deshacer también, el resultado es «a medias» y el aviso lo dice con los dos números", async () => {
    const q = orden({ id: "q", order_no: 5 });
    const a = orden({ id: "a", order_no: 9, po2: "PO-2", est_pallets: 2 });
    const { esc } = falso({ update: [true, false], stage: false });
    const r = await juntarExistentes(esc, { queda: q, anula: a, idPropia: "a", propia: { invoice_num: "F" }, factura: "F", minutosPorPallet: MINUTOS, lang: "es" });
    expect(r).toBe("a_medias");
    const aviso = avisoTrasJuntar(r, q, a, "es")!;
    expect(aviso).toContain("#5 ya tiene la PO y los pallets de #9");
    expect(aviso).toContain("#9 NO se anuló");
    expect(avisoTrasJuntar("juntada", q, a, "es")).toBe("#9 se juntó en #5 (un viaje) y quedó anulada");
    expect(avisoTrasJuntar("sin_escribir", q, a, "es")).toBeNull();
  });

  it("deshacer devuelve los campos del parche con su valor de antes (null si no había)", () => {
    expect(deshacerAlJuntar({ po2: "PO-1", est_pallets: null }, { po2: "PO-1, PO-2", est_pallets: 2 })).toEqual({ po2: "PO-1", est_pallets: null });
    expect(deshacerAlJuntar({ po2: "PO-1" }, {})).toEqual({});
  });
});

describe("D-557 · las tres pantallas usan la regla", () => {
  it("la pregunta: con quién, cuál se queda y quién puede salen de la librería; «Juntar» solo si puede", () => {
    const c = leer("src/components/PreguntaJuntarExistente.tsx");
    expect(c).toContain("const con = ofreceJuntarExistente(despues, factura, deliveries, settings.order_type_rules);");
    expect(c).toContain("const { queda, anula } = quienSeQueda<Delivery>(despues, con);");
    expect(c).toContain("const porque = porQueNoPuedeJuntar(me?.role, queda.stage, anula.stage);");
    expect(c).toContain("const resultado = await juntarExistentes(");
    expect(c).toContain("if (porque) return { r: \"parar\" };");
    expect(c).toContain("{!pregunta.porque && (");
  });

  it("la ficha pregunta al guardar una orden que ya existe y en «Agregar material»; «Dejarla aparte» no repite el aviso", () => {
    const modal = leer("src/components/OrderModal.tsx");
    expect(modal).toContain("const salida = await juntarExistente.intentar(existing, payload, facturaNuevaAlEditar(existing, payload));");
    expect(modal).toContain("if ((payload.stage ?? \"draft\") !== \"draft\" && !(await passesChecks(payload, { facturaYaDecidida: facturaDecidida }))) return;");
    expect(modal).toContain("const salida = await juntarExistente.intentar(existing, parche, facturaNuevaAlEditar(existing, parche));");
    expect(modal).toContain("{juntarExistente.dialogo}");
  });

  it("«Factura pendiente» desde la fila pregunta antes de escribir, y «Dejarla aparte» no repite el aviso", () => {
    const fila = leer("src/components/DocumentoPendiente.tsx");
    expect(fila).toContain("await juntar.intentar(d, { invoice_num: valor }, valor)");
    expect(fila).toContain("const otra = campo === \"invoice_num\" && !salida.decidida ? otraConLaMismaFactura(d.id, valor, deliveries) : undefined;");
    expect(fila).toContain("{juntar.dialogo}");
    expect(fila.indexOf("await juntar.intentar(")).toBeLessThan(fila.indexOf("await ponerDocumento("));
  });
});
