import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claveDeIntento, esFuncionSinAplicar, llamarCargaParcial, type ArgsCargaParcial } from "./carga-parcial";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const traduce = (m: string) => m;

const args = (over: Partial<ArgsCargaParcial> = {}): ArgsCargaParcial => ({
  orden: "orden-1", pallets: 4, clave: "clave-A",
  cambios: { pickup_gps_at: "2026-11-27T10:00:00Z", assigned_driver: "Diego" },
  nota: "Carga parcial: 4 de 10", notaResto: "División de #900001a", ...over,
});

/**
 * Un doble de la base que hace lo que hace `public.carga_parcial` (migración 357), en memoria:
 * la clave se mira después de bloquear la orden, un intento con la misma clave devuelve su resto, una orden ya
 * recogida no se parte otra vez, y la respuesta puede perderse DESPUÉS de escribir (mala señal).
 */
function bdFalsa(opts: { perderRespuestaUna?: boolean } = {}) {
  const ordenes = new Map<string, { stage: string; total: number; suffix: string }>([
    ["orden-1", { stage: "ready", total: 10, suffix: "a" }],
  ]);
  const intentos = new Map<string, { orden: string; resto: string }>();
  let filas = 0;
  let perder = !!opts.perderRespuestaUna;
  const rpc = async (fn: string, a: Record<string, unknown>) => {
    if (fn !== "carga_parcial") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    const orden = ordenes.get(String(a.p_orden));
    if (!orden) return { data: null, error: { code: "P0002", message: "CARGA_NOT_FOUND" } };
    const previo = intentos.get(String(a.p_clave));
    if (previo) {
      if (previo.orden !== a.p_orden) return { data: null, error: { code: "P0001", message: "CARGA_CLAVE: that split key belongs to another order" } };
      return { data: previo.resto, error: null };
    }
    if (!["approved", "fulfilling", "ready"].includes(orden.stage)) {
      return { data: null, error: { code: "P0001", message: `CARGA_STAGE: an order in ${orden.stage} is not split at pickup` } };
    }
    const cargadas = Number(a.p_pallets_cargados);
    if (!(cargadas > 0 && cargadas < orden.total)) {
      return { data: null, error: { code: "P0001", message: "CARGA_BAD_SPLIT" } };
    }
    filas += 1;
    const resto = `resto-${filas}`;
    ordenes.set(String(a.p_orden), { ...orden, stage: "picked_up" });
    ordenes.set(resto, { stage: "ready", total: orden.total - cargadas, suffix: "b" });
    intentos.set(String(a.p_clave), { orden: String(a.p_orden), resto });
    if (perder) {
      perder = false;
      // Se escribió, pero la respuesta se pierde en el camino: el cliente no lo sabe.
      return { data: null, error: { message: "TypeError: Failed to fetch" } };
    }
    return { data: resto, error: null };
  };
  return { rpc, filasCreadas: () => filas, orden: (id: string) => ordenes.get(id) };
}

describe("carga parcial · cliente", () => {
  it("usa la función de la base y le pasa el recuento, la clave y solo los campos de la recogida", async () => {
    const llamadas: Array<[string, Record<string, unknown>]> = [];
    const r = await llamarCargaParcial(async (fn, a) => { llamadas.push([fn, a]); return { data: "resto-1", error: null }; }, args(), traduce);
    expect(r).toEqual({ estado: "ok", restoId: "resto-1" });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0][0]).toBe("carga_parcial");
    expect(llamadas[0][1]).toEqual({
      p_orden: "orden-1", p_pallets_cargados: 4, p_clave: "clave-A",
      p_cambios: { pickup_gps_at: "2026-11-27T10:00:00Z", assigned_driver: "Diego" },
      p_nota: "Carga parcial: 4 de 10", p_nota_resto: "División de #900001a",
    });
  });

  it("si la 357 no está aplicada (PGRST202), cae al camino viejo: estado sin-funcion", async () => {
    const r = await llamarCargaParcial(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.carga_parcial" } }), args(), traduce);
    expect(r).toEqual({ estado: "sin-funcion" });
  });

  it("reconoce la función que no existe por código o por mensaje, y no confunde otros errores", () => {
    expect(esFuncionSinAplicar({ code: "PGRST202" })).toBe(true);
    expect(esFuncionSinAplicar({ code: "42883" })).toBe(true);
    expect(esFuncionSinAplicar({ message: "Could not find the function public.carga_parcial(...)" })).toBe(true);
    expect(esFuncionSinAplicar({ code: "P0001", message: "CARGA_BAD_SPLIT" })).toBe(false);
    expect(esFuncionSinAplicar(null)).toBe(false);
  });

  it("un error de la regla (la base lo rechaza) no es reintentable: se suelta la clave", async () => {
    const r = await llamarCargaParcial(async () => ({ data: null, error: { code: "P0001", message: "CARGA_STAGE: an order in picked_up is not split at pickup" } }), args(), (m) => `ES:${m}`);
    expect(r).toEqual({ estado: "error", mensaje: "ES:CARGA_STAGE: an order in picked_up is not split at pickup", reintentable: false });
  });

  it("sin respuesta de la base (sin código) sí es reintentable, y una excepción también", async () => {
    const sinRed = await llamarCargaParcial(async () => ({ data: null, error: { message: "TypeError: Failed to fetch" } }), args(), traduce);
    expect(sinRed).toMatchObject({ estado: "error", reintentable: true });
    const lanza = await llamarCargaParcial(async () => { throw new Error("network down"); }, args(), traduce);
    expect(lanza).toEqual({ estado: "error", mensaje: "network down", reintentable: true });
  });

  it("claveDeIntento reusa la clave mientras sea la misma orden y el mismo recuento, y genera otra si cambia", () => {
    let n = 0;
    const nueva = () => `k${++n}`;
    const primera = claveDeIntento(null, "orden-1", 4, nueva);
    expect(primera.clave).toBe("k1");
    expect(claveDeIntento(primera, "orden-1", 4, nueva).clave).toBe("k1");
    expect(claveDeIntento(primera, "orden-1", 5, nueva).clave).toBe("k2");
    expect(claveDeIntento(primera, "orden-2", 4, nueva).clave).toBe("k3");
    expect(n).toBe(3);
  });

  it("un reintento con la MISMA clave tras perder la respuesta no duplica el resto", async () => {
    const bd = bdFalsa({ perderRespuestaUna: true });
    const intento1 = claveDeIntento(null, "orden-1", 4, () => "clave-A");
    const primera = await llamarCargaParcial(bd.rpc, args({ clave: intento1.clave }), traduce);
    expect(primera).toMatchObject({ estado: "error", reintentable: true });
    // La base SÍ escribió: el reintento con la misma clave debe devolver el mismo resto y no partir otra vez.
    const intento2 = claveDeIntento(intento1, "orden-1", 4, () => "clave-NUEVA");
    expect(intento2.clave).toBe("clave-A");
    const segunda = await llamarCargaParcial(bd.rpc, args({ clave: intento2.clave }), traduce);
    expect(segunda).toEqual({ estado: "ok", restoId: "resto-1" });
    expect(bd.filasCreadas()).toBe(1);
  });

  it("un doble toque (dos llamadas con la misma clave) tampoco parte dos veces", async () => {
    const bd = bdFalsa();
    const [a, b] = await Promise.all([
      llamarCargaParcial(bd.rpc, args({ clave: "clave-A" }), traduce),
      llamarCargaParcial(bd.rpc, args({ clave: "clave-A" }), traduce),
    ]);
    expect(a).toEqual({ estado: "ok", restoId: "resto-1" });
    expect(b).toEqual({ estado: "ok", restoId: "resto-1" });
    expect(bd.filasCreadas()).toBe(1);
  });

  it("una clave NUEVA para una orden ya recogida la rechaza la base: no hay segundo resto", async () => {
    const bd = bdFalsa();
    await llamarCargaParcial(bd.rpc, args({ clave: "clave-A" }), traduce);
    const otra = await llamarCargaParcial(bd.rpc, args({ clave: "clave-B" }), traduce);
    expect(otra).toMatchObject({ estado: "error", reintentable: false });
    expect(bd.filasCreadas()).toBe(1);
  });

  it("la pantalla pasa por la función nueva antes que por el camino viejo, y conserva el camino viejo como respaldo", () => {
    const modal = leer("src/components/OrderModal.tsx");
    const nuevo = modal.indexOf("const r = await cargaParcial({");
    const viejo = modal.indexOf("const rowB = await addDelivery({");
    expect(nuevo).toBeGreaterThan(-1);
    expect(viejo).toBeGreaterThan(nuevo);
    expect(modal).toContain("const intento = claveDeIntento(claveRef.current, existing.id, n, () => crypto.randomUUID());");
    expect(modal).toContain("if (!r.reintentable) claveRef.current = null;");
    expect(modal).toContain('const ok = await setStage(\n        existing.id, "picked_up",');
  });

  it("el proveedor llama a carga_parcial por rpc y no escribe en modo enseñanza", () => {
    const dp = leer("src/lib/data-provider.tsx");
    expect(dp).toContain("const res = await llamarCargaParcial(");
    expect(dp).toContain("(fn, args) => supabase.rpc(fn, args)");
    expect(dp).toMatch(/if \(teaching\) return \{ estado: "sin-funcion" \};\n\s+const current/);
  });
});
