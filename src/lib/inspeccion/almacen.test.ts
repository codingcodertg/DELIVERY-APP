import { describe, expect, it } from "vitest";
import {
  FUNCION_DE_CORREGIDO, FUNCION_DE_VEHICULOS, LLAVE_DEL_DEMO, TABLA_DE_INSPECCIONES, corrigeEnElNavegador, faltaLaFuncion,
  faltaLaTabla, guardaEnElNavegador, guardaInspeccion, leeDelNavegador, leeInspecciones, leeVehiculos, marcaCorregido,
  semillasDelDemo, vehiculoPorDefecto, vehiculosDelDemo,
  type ClienteDeInspecciones, type ErrorDeLaBase,
} from "./almacen";
import type { Inspeccion, InspeccionNueva } from "./reglas";

/** Un cliente de mentira que apunta lo que se le pide y contesta lo que se le diga. */
function clienteFalso(respuesta: { data?: unknown; error?: ErrorDeLaBase | null }) {
  const llamadas: { op: string; args: unknown[] }[] = [];
  const contesta = () => Promise.resolve({ data: (respuesta.data ?? null) as never, error: respuesta.error ?? null });
  const consulta = (): never => {
    const q = {
      eq: (...args: unknown[]) => { llamadas.push({ op: "eq", args }); return q; },
      order: (...args: unknown[]) => { llamadas.push({ op: "order", args }); return q; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => contesta().then(ok, ko),
    };
    return q as never;
  };
  const cliente: ClienteDeInspecciones = {
    from: (tabla) => {
      llamadas.push({ op: "from", args: [tabla] });
      return {
        select: (c) => { llamadas.push({ op: "select", args: [c] }); return consulta(); },
        insert: (f) => { llamadas.push({ op: "insert", args: [f] }); return { select: () => ({ single: () => contesta() as never }) }; },
      };
    },
    rpc: (fn, args) => { llamadas.push({ op: "rpc", args: [fn, args] }); return contesta() as never; },
  };
  return { cliente, llamadas };
}

const nueva = (x: Partial<InspeccionNueva> = {}): InspeccionNueva => ({
  driver_id: "u-drv", driver_name: "Diego Driver", inspection_date: "2026-10-11", vehicle_id: "veh-demo-3", vehicle_label: "Camión 3",
  odometer: 84213, answers: { bocina: { estado: "defecto", nota: "bajito", fotos: ["data:x"] }, frenos: { estado: "ok" } }, safe: true,
  notes: null, certified: true, checklist_version: "v", ...x,
});

function almacenDeMemoria() {
  const datos = new Map<string, string>();
  return { getItem: (k: string) => datos.get(k) ?? null, setItem: (k: string, v: string) => void datos.set(k, v), datos };
}

describe("la base: qué error es «falta la migración»", () => {
  it("tabla: PGRST205 / 42P01, o el mensaje con el nombre de la tabla", () => {
    expect(faltaLaTabla({ code: "PGRST205" })).toBe(true);
    expect(faltaLaTabla({ code: "42P01" })).toBe(true);
    expect(faltaLaTabla({ message: `Could not find the table 'public.${TABLA_DE_INSPECCIONES}' in the schema cache` })).toBe(true);
    expect(faltaLaTabla({ code: "42501", message: "permission denied" })).toBe(false);
    expect(faltaLaTabla(null)).toBe(false);
  });
  it("función: PGRST202 / 42883", () => {
    expect(faltaLaFuncion({ code: "PGRST202" })).toBe(true);
    expect(faltaLaFuncion({ code: "42883" })).toBe(true);
    expect(faltaLaFuncion({ code: "42501" })).toBe(false);
  });
});

describe("leer las inspecciones de un día", () => {
  it("pide la tabla, el día y, para un chofer, solo las suyas; por hora", async () => {
    const { cliente, llamadas } = clienteFalso({ data: [] });
    await leeInspecciones(cliente, "2026-10-11", "u1");
    expect(llamadas.map((l) => [l.op, ...l.args])).toEqual([
      ["from", TABLA_DE_INSPECCIONES], ["select", "*"], ["eq", "inspection_date", "2026-10-11"], ["eq", "driver_id", "u1"],
      ["order", "created_at", { ascending: true }],
    ]);
  });
  it("logística (sin chofer) no filtra por chofer", async () => {
    const { cliente, llamadas } = clienteFalso({ data: [] });
    await leeInspecciones(cliente, "2026-10-11", null);
    expect(llamadas.filter((l) => l.op === "eq").map((l) => l.args[0])).toEqual(["inspection_date"]);
  });
  it("la fila de la base sale normalizada: el día sin hora, el odómetro número, jsonb vacío si falta", async () => {
    const { cliente } = clienteFalso({ data: [{ id: "x", inspection_date: "2026-10-11T00:00:00", odometer: "84213.5", answers: null, repairs: null, created_at: "z" }] });
    const r = await leeInspecciones(cliente, "2026-10-11", null);
    expect(r.estado).toBe("listo");
    expect(r.filas[0]).toMatchObject({ inspection_date: "2026-10-11", odometer: 84213.5, answers: {}, repairs: {} });
  });
  it("sin la 165: `sin_tabla`; otro fallo: `error`, con el detalle", async () => {
    expect((await leeInspecciones(clienteFalso({ error: { code: "PGRST205", message: "no" } }).cliente, "d", null)).estado).toBe("sin_tabla");
    const e = await leeInspecciones(clienteFalso({ error: { code: "500", message: "caída" } }).cliente, "d", null);
    expect([e.estado, e.detalle]).toEqual(["error", "caída"]);
  });
});

describe("guardar una", () => {
  it("inserta la fila y devuelve la de la base", async () => {
    const { cliente, llamadas } = clienteFalso({ data: { ...nueva(), id: "nuevo", repairs: null, created_at: "t" } });
    const r = await guardaInspeccion(cliente, nueva());
    expect(r).toMatchObject({ ok: true, fila: { id: "nuevo", repairs: {} } });
    expect(llamadas.find((l) => l.op === "insert")?.args[0]).toEqual(nueva());
  });
  it("la repetida (índice único, 23505) se dice como tal; sin la 165, `sin_tabla`", async () => {
    expect(await guardaInspeccion(clienteFalso({ error: { code: "23505" } }).cliente, nueva())).toEqual({ ok: false, motivo: "repetida" });
    expect(await guardaInspeccion(clienteFalso({ error: { code: "42P01", message: "x" } }).cliente, nueva())).toMatchObject({ ok: false, motivo: "sin_tabla" });
    expect(await guardaInspeccion(clienteFalso({ error: { code: "42501", message: "rls" } }).cliente, nueva())).toMatchObject({ ok: false, motivo: "error", detalle: "rls" });
  });
});

describe("marcar un defecto corregido", () => {
  it("llama a la función con sus argumentos; la nota vacía va nula", async () => {
    const { cliente, llamadas } = clienteFalso({ data: { bocina: { at: "t" } } });
    const r = await marcaCorregido(cliente, "i1", "bocina", true, "  ");
    expect(r).toEqual({ ok: true, repairs: { bocina: { at: "t" } } });
    expect(llamadas[0].args).toEqual([FUNCION_DE_CORREGIDO, { p_inspeccion: "i1", p_punto: "bocina", p_corregido: true, p_nota: null }]);
  });
  it("un rechazo de la base se devuelve, no se finge", async () => {
    expect(await marcaCorregido(clienteFalso({ error: { code: "42501", message: "only admin or logistics" } }).cliente, "i", "p", true, "")).toEqual({ ok: false, detalle: "only admin or logistics" });
  });
});

describe("los vehículos", () => {
  it("de la función; sin ella, `sin_funcion` y lista vacía (el chofer lo escribe)", async () => {
    const { cliente, llamadas } = clienteFalso({ data: [{ id: "a", name: "Camión 3", plate: null, assigned: null }] });
    expect(await leeVehiculos(cliente)).toEqual({ estado: "listo", vehiculos: [{ id: "a", name: "Camión 3", plate: null, assigned: false }] });
    expect(llamadas[0].args[0]).toBe(FUNCION_DE_VEHICULOS);
    expect(await leeVehiculos(clienteFalso({ error: { code: "PGRST202" } }).cliente)).toEqual({ estado: "sin_funcion", vehiculos: [] });
  });
  it("sale elegido el asignado; si no hay, el primero; sin ninguno, nada", () => {
    expect(vehiculoPorDefecto(vehiculosDelDemo("u-drv"))).toEqual({ id: "veh-demo-3", etiqueta: "Camión 3 · TX 4KD-221" });
    expect(vehiculoPorDefecto(vehiculosDelDemo("u-drv2"))?.id).toBe("veh-demo-5");
    expect(vehiculoPorDefecto(vehiculosDelDemo("nadie"))?.id).toBe("veh-demo-3");
    expect(vehiculoPorDefecto([])).toBeNull();
  });
});

describe("en este navegador (demo y práctica)", () => {
  it("el demo siembra dos del día pedido, una vez, y una de ellas no es segura", () => {
    const a = almacenDeMemoria();
    const r = leeDelNavegador(a, LLAVE_DEL_DEMO, "2026-10-11", null, true);
    expect(r.filas.map((f) => [f.driver_name, f.safe])).toEqual([["Carlos R.", true], ["Miguel A.", false]]);
    leeDelNavegador(a, LLAVE_DEL_DEMO, "2026-10-11", null, true);
    expect((JSON.parse(a.datos.get(LLAVE_DEL_DEMO)!) as Inspeccion[]).length).toBe(2);
    expect(leeDelNavegador(a, LLAVE_DEL_DEMO, "2026-10-11", "u-drv", true).filas).toEqual([]);
    expect(semillasDelDemo("2026-10-11").every((s) => s.inspection_date === "2026-10-11")).toBe(true);
  });

  it("la práctica no siembra nada", () => {
    expect(leeDelNavegador(almacenDeMemoria(), "otra", "2026-10-11", null, false).filas).toEqual([]);
  });

  it("guarda; la misma (chofer, día, vehículo) otra vez es `repetida`; otro vehículo sí entra", () => {
    const a = almacenDeMemoria();
    const ahora = new Date("2026-10-11T12:00:00.000Z");
    const g = guardaEnElNavegador(a, LLAVE_DEL_DEMO, nueva(), ahora);
    expect(g).toMatchObject({ ok: true, fila: { driver_id: "u-drv", repairs: {}, created_at: ahora.toISOString() } });
    expect(guardaEnElNavegador(a, LLAVE_DEL_DEMO, nueva(), ahora)).toEqual({ ok: false, motivo: "repetida" });
    expect(guardaEnElNavegador(a, LLAVE_DEL_DEMO, nueva({ vehicle_id: "veh-demo-5" }), ahora).ok).toBe(true);
    expect(leeDelNavegador(a, LLAVE_DEL_DEMO, "2026-10-11", "u-drv", false).filas).toHaveLength(2);
  });

  it("sin sitio en el navegador, falla y lo dice", () => {
    const lleno = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(guardaEnElNavegador(lleno, LLAVE_DEL_DEMO, nueva(), new Date())).toMatchObject({ ok: false, motivo: "error" });
  });

  it("marcar corregido sella quién y cuándo; desmarcar lo quita; algo que no es defecto no se marca", () => {
    const a = almacenDeMemoria();
    const g = guardaEnElNavegador(a, LLAVE_DEL_DEMO, nueva(), new Date("2026-10-11T12:00:00.000Z"));
    if (!g.ok) throw new Error("no guardó");
    const quien = { id: "u-log", nombre: "Laura Logistics" };
    const r = corrigeEnElNavegador(a, LLAVE_DEL_DEMO, g.fila.id, "bocina", true, " cambiada ", quien, new Date("2026-10-11T14:00:00.000Z"));
    expect(r).toEqual({ ok: true, repairs: { bocina: { at: "2026-10-11T14:00:00.000Z", by: "u-log", by_name: "Laura Logistics", note: "cambiada" } } });
    expect(leeDelNavegador(a, LLAVE_DEL_DEMO, "2026-10-11", null, false).filas[0].repairs.bocina?.by).toBe("u-log");
    expect(corrigeEnElNavegador(a, LLAVE_DEL_DEMO, g.fila.id, "bocina", false, "", quien, new Date())).toEqual({ ok: true, repairs: {} });
    expect(corrigeEnElNavegador(a, LLAVE_DEL_DEMO, g.fila.id, "frenos", true, "", quien, new Date())).toEqual({ ok: false, detalle: "ese punto no es un defecto" });
    expect(corrigeEnElNavegador(a, LLAVE_DEL_DEMO, "no-existe", "bocina", true, "", quien, new Date())).toEqual({ ok: false, detalle: "no existe" });
  });
});
