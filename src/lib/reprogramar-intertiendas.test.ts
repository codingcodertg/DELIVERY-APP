import { describe, expect, it } from "vitest";
import {
  ejecutarReprogramacion, esIntertienda, hoyEnTexas, notaDeReprogramacion, reprogramarIntertiendas,
  type ClienteMinimo, type OrdenParaReprogramar,
} from "@/lib/reprogramar-intertiendas";
import type { OrderTypeRules } from "@/lib/required";

// D-NEXT. El dueño, 2026-09-26: «si intertienda no se entregó ese día se reprograma automáticamente
// para el día siguiente».

const REGLAS: OrderTypeRules = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" },
};
const HOY = "2026-09-26";
const o = (id: string, extra: Partial<OrdenParaReprogramar> = {}): OrdenParaReprogramar =>
  ({ id, order_type: "Intertienda", stage: "approved", delivery_date: "2026-09-25", is_training: false, order_code: id.toUpperCase(), ...extra });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("la regla: qué Intertienda se mueve y a qué día", () => {
  it("la de ayer sin entregar pasa a hoy, con su fecha anterior", () => {
    expect(reprogramarIntertiendas([o("a")], HOY, REGLAS)).toEqual([{ id: "a", etiqueta: "A", antes: "2026-09-25", despues: HOY }]);
  });

  it("la de hoy y la de mañana no se tocan", () => {
    expect(reprogramarIntertiendas([o("hoy", { delivery_date: HOY }), o("manana", { delivery_date: "2026-09-27" })], HOY, REGLAS)).toEqual([]);
  });

  it("la que faltó varios días va a HOY, no al día siguiente de su fecha", () => {
    const [m] = reprogramarIntertiendas([o("vieja", { delivery_date: "2026-09-20" })], HOY, REGLAS);
    expect(m.antes).toBe("2026-09-20");
    expect(m.despues).toBe(HOY);
  });

  it("entregada, anulada, borrador y rechazada no se mueven; pending, approved, fulfilling, ready y picked_up sí", () => {
    const quietas = ["delivered", "canceled", "draft", "rejected"].map((s) => o(`q-${s}`, { stage: s }));
    const abiertas = ["pending", "approved", "fulfilling", "ready", "picked_up"].map((s) => o(`m-${s}`, { stage: s }));
    // Mezcladas y con las que se mueven primero y último, para que un filtro al revés no pase.
    const r = reprogramarIntertiendas([abiertas[0], ...quietas, ...abiertas.slice(1)], HOY, REGLAS);
    expect(ids(r).sort()).toEqual(abiertas.map((x) => x.id).sort());
  });

  it("Customer y Transfer (tienda-a-tienda que NO recibe) no se mueven", () => {
    const r = reprogramarIntertiendas([o("c", { order_type: "Customer" }), o("t", { order_type: "Transfer" }), o("i")], HOY, REGLAS);
    expect(ids(r)).toEqual(["i"]);
  });

  it("decide la regla de Ajustes, no el nombre del tipo", () => {
    const renombrada: OrderTypeRules = { "Entre Sucursales": { storeToStore: true, homeIsDestination: true }, Intertienda: { storeToStore: true } };
    const r = reprogramarIntertiendas([o("renombrada", { order_type: "Entre Sucursales" }), o("nombre", { order_type: "Intertienda" })], HOY, renombrada);
    expect(ids(r)).toEqual(["renombrada"]);
    expect(esIntertienda("Intertienda", REGLAS)).toBe(true);
    expect(esIntertienda("Transfer", REGLAS)).toBe(false);
  });

  it("sin fecha no se toca, ni una de enseñanza", () => {
    expect(reprogramarIntertiendas([o("sin", { delivery_date: null }), o("ens", { is_training: true })], HOY, REGLAS)).toEqual([]);
  });

  it("la nota lleva la fecha anterior y la nueva", () => {
    expect(notaDeReprogramacion("2026-09-25", HOY)).toBe("Reprogramada automáticamente: 2026-09-25 → 2026-09-26 (no se entregó)");
  });
});

describe("«hoy» es el de Texas, no el de UTC", () => {
  it("a las 04:30 UTC del 27 (23:30 CDT) todavía es 26 en Texas; a las 05:30 UTC ya es 27", () => {
    expect(hoyEnTexas(new Date("2026-09-27T04:30:00Z"))).toBe("2026-09-26");
    expect(hoyEnTexas(new Date("2026-09-27T05:30:00Z"))).toBe("2026-09-27");
  });
  it("en invierno (CST, UTC-6): a las 05:30 UTC del 2 de diciembre todavía es 1", () => {
    expect(hoyEnTexas(new Date("2026-12-02T05:30:00Z"))).toBe("2026-12-01");
  });
});

// ---- La ejecución, con un cliente de Supabase falso ----------------------------------------------

type Op = { tabla: string; op: string; valor?: unknown; filtros: string[] };
function clienteFalso(datos: { ordenes: OrdenParaReprogramar[]; reglas?: OrderTypeRules; updateVacio?: string[]; eventoFalla?: boolean }) {
  const ops: Op[] = [];
  const cliente: ClienteMinimo = {
    from: (tabla: string) => {
      const op: Op = { tabla, op: "select", filtros: [] };
      const resuelve = () => {
        ops.push(op);
        if (tabla === "settings") return { data: { order_type_rules: datos.reglas ?? REGLAS, order_types: ["Customer", "Intertienda", "Transfer"] }, error: null };
        if (tabla === "deliveries" && op.op === "select") return { data: datos.ordenes, error: null };
        if (tabla === "deliveries" && op.op === "update") {
          const id = op.filtros.find((f) => f.startsWith("eq:id="))?.slice(6) ?? "";
          return { data: datos.updateVacio?.includes(id) ? [] : [{ id }], error: null };
        }
        if (tabla === "order_events") return { data: null, error: datos.eventoFalla ? { message: "sin permiso" } : null };
        return { data: null, error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      for (const m of ["eq", "lt"]) q[m] = (c: string, v: unknown) => { op.filtros.push(`${m}:${c}=${v}`); return q; };
      q.not = (c: string, o2: string, v: unknown) => { op.filtros.push(`not:${c}:${o2}=${v}`); return q; };
      q.update = (v: unknown) => { op.op = "update"; op.valor = v; return q; };
      q.insert = (v: unknown) => { op.op = "insert"; op.valor = v; return q; };
      q.maybeSingle = async () => resuelve();
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resuelve()).then(ok);
      return q;
    },
  };
  return { cliente, ops, escrituras: () => ops.filter((x) => x.op !== "select") };
}
// 12:00 UTC del 26 = 07:00 en Texas del 26.
const AHORA = new Date("2026-09-26T12:00:00Z");

describe("ejecutarReprogramacion", () => {
  it("en ensayo no escribe nada y devuelve lo que haría", async () => {
    const f = clienteFalso({ ordenes: [o("a"), o("c", { order_type: "Customer" })] });
    const r = await ejecutarReprogramacion(f.cliente, { ahora: AHORA, ensayo: true });
    expect(f.escrituras()).toEqual([]);
    expect(r).toMatchObject({ ok: true, ensayo: true, hoy: HOY, revisadas: 2, movidas: 1, tipos: ["Intertienda"] });
    expect(r.ordenes).toEqual([{ id: "a", etiqueta: "A", antes: "2026-09-25", despues: HOY }]);
  });

  it("pide a la base solo las candidatas: no de enseñanza, fecha anterior a hoy, etapa abierta", async () => {
    const f = clienteFalso({ ordenes: [] });
    await ejecutarReprogramacion(f.cliente, { ahora: AHORA, ensayo: true });
    const lectura = f.ops.find((x) => x.tabla === "deliveries")!;
    expect(lectura.filtros).toEqual(["eq:is_training=false", `lt:delivery_date=${HOY}`, "not:stage:in=(delivered,canceled,draft,rejected)"]);
  });

  it("de verdad: cambia la fecha solo si sigue siendo la leída, y escribe el evento con el valor anterior", async () => {
    const f = clienteFalso({ ordenes: [o("a", { delivery_date: "2026-09-22" })] });
    const r = await ejecutarReprogramacion(f.cliente, { ahora: AHORA, ensayo: false });
    expect(f.escrituras()).toEqual([
      { tabla: "deliveries", op: "update", valor: { delivery_date: HOY }, filtros: ["eq:id=a", "eq:delivery_date=2026-09-22"] },
      { tabla: "order_events", op: "insert", filtros: [], valor: { delivery_id: "a", kind: "edited", note: "Reprogramada automáticamente: 2026-09-22 → 2026-09-26 (no se entregó)", created_by: null } },
    ]);
    expect(r).toMatchObject({ ok: true, ensayo: false, movidas: 1, fallos: [] });
  });

  it("si el UPDATE no cambió ninguna fila, no se cuenta como movida ni se escribe evento", async () => {
    const f = clienteFalso({ ordenes: [o("a"), o("b")], updateVacio: ["a"] });
    const r = await ejecutarReprogramacion(f.cliente, { ahora: AHORA, ensayo: false });
    expect(ids(r.ordenes)).toEqual(["b"]);
    expect(r.fallos.map((x) => x.id)).toEqual(["a"]);
    expect(r.ok).toBe(false);
    expect(f.escrituras().filter((x) => x.tabla === "order_events").map((x) => (x.valor as { delivery_id: string }).delivery_id)).toEqual(["b"]);
  });

  it("si el evento no se pudo escribir, la fecha vuelve a la anterior: nunca una fecha cambiada sin rastro", async () => {
    const f = clienteFalso({ ordenes: [o("a", { delivery_date: "2026-09-24" })], eventoFalla: true });
    const r = await ejecutarReprogramacion(f.cliente, { ahora: AHORA, ensayo: false });
    const ultima = f.escrituras().at(-1)!;
    expect(ultima).toEqual({ tabla: "deliveries", op: "update", valor: { delivery_date: "2026-09-24" }, filtros: ["eq:id=a", `eq:delivery_date=${HOY}`] });
    expect(r.movidas).toBe(0);
    expect(r.fallos[0].error).toContain("2026-09-24");
  });

  it("«hoy» sale del reloj que se le pasa, en Texas: a las 04:30 UTC del 27 la del 26 no se mueve", async () => {
    const f = clienteFalso({ ordenes: [o("del26", { delivery_date: "2026-09-26" }), o("del25")] });
    const r = await ejecutarReprogramacion(f.cliente, { ahora: new Date("2026-09-27T04:30:00Z"), ensayo: true });
    expect(r.hoy).toBe("2026-09-26");
    expect(ids(r.ordenes)).toEqual(["del25"]);
  });

  // Lejos del reloj de la máquina: con fechas de 2026-09 la prueba de arriba pasaba igual si la
  // ejecución leía el reloj real (se escribió el 2026-09-26), y el mutante sobrevivió.
  it("usa el reloj que se le pasa y no el de la máquina (año 2030, fin de año en Texas)", async () => {
    const f = clienteFalso({ ordenes: [o("nochevieja", { delivery_date: "2029-12-31" }), o("anonuevo", { delivery_date: "2030-01-01" })] });
    const r = await ejecutarReprogramacion(f.cliente, { ahora: new Date("2030-01-02T05:30:00Z"), ensayo: true });
    expect(r.hoy).toBe("2030-01-01");
    expect(r.ordenes).toEqual([{ id: "nochevieja", etiqueta: "NOCHEVIEJA", antes: "2029-12-31", despues: "2030-01-01" }]);
  });
});
