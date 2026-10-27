import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  consultaDelCupo, estadoDeFranja, franjasDelDia, nombreDeFranja, textoDeFranja, ventanasDeLasFranjas, type Franja,
} from "./franjas-del-dia";
import { motivoPorCupo, type ReglasDeAprobacion } from "./aprobacion-por-hora-y-cupo";

/**
 * Las franjas del día en la ficha de la orden (D-657): Kevin Gonzalez quería ver, al crear una orden, qué franjas
 * quedan ese día. Se prueba la función que las arma (con datos que contradicen: tiendas inventadas, cupos fuera de
 * orden, una ventana con cupo que no es de la lista), la ruta que cuenta (sin sesión 401, y solo números), la tarjeta
 * (pulsar elige esa franja) y cómo la cablea la ficha.
 */

// Tiendas inventadas: el repo no afirma los nombres de Ajustes.
const R: ReglasDeAprobacion = { corte: "16:30", cupo: { "0830-1000": 2, "0830-1200": 1 }, tiendas_sin_cupo: ["Tienda Lejos"] };
// 2026-10-22 es jueves en horario de verano: las 16:30 de Texas son las 21:30Z.
const JUEVES_1000 = new Date("2026-10-22T15:00:00Z");
const JUEVES_1630 = new Date("2026-10-22T21:30:00Z");
const MARTES = "2026-10-27";
const SABADO = "2026-10-31";

const porVentana = (fs: Franja[]) => Object.fromEntries(fs.map((f) => [f.ventana, f]));

describe("qué franjas se enseñan", () => {
  it("entre semana: las cuatro del selector, por hora de empezar y luego de acabar", () => {
    expect(ventanasDeLasFranjas(MARTES, R)).toEqual(["0830-1000", "0830-1200", "0830-1730", "1200-1730"]);
  });

  it("en sábado: sin «tarde» ni el todo-el-día de entre semana", () => {
    expect(ventanasDeLasFranjas(SABADO, R)).toEqual(["0830-1000", "0830-1200", "0830-1530"]);
  });

  it("una ventana con cupo en Ajustes que no es del selector también sale, en su sitio y no al final", () => {
    // Las claves llegan desordenadas a propósito: el orden lo da la hora, no Ajustes.
    const r = { ...R, cupo: { "1300-1500": 1, "0900-1100": 3, "0830-1000": 2 } };
    expect(ventanasDeLasFranjas(MARTES, r)).toEqual(["0830-1000", "0830-1200", "0830-1730", "0900-1100", "1200-1730", "1300-1500"]);
  });

  it("una ventana con cupo que acaba después del cierre de ese día no sale (sábado cierra 3:30)", () => {
    const r = { ...R, cupo: { ...R.cupo, "1300-1700": 1 } };
    expect(ventanasDeLasFranjas(SABADO, r)).not.toContain("1300-1700");
    expect(ventanasDeLasFranjas(MARTES, r)).toContain("1300-1700");
  });

  it("sin fecha válida no hay franjas", () => {
    expect(franjasDelDia({ fecha: "", tienda: "Tienda Centro", ocupadas: {}, reglas: R, ahora: JUEVES_1000 })).toEqual([]);
    expect(franjasDelDia({ fecha: "27/10/2026", tienda: "Tienda Centro", ocupadas: {}, reglas: R, ahora: JUEVES_1000 })).toEqual([]);
  });
});

describe("estado de cada franja", () => {
  it("quedan, llena y libre en el mismo día", () => {
    const f = porVentana(franjasDelDia({ fecha: MARTES, tienda: "Tienda Centro", ocupadas: { "0830-1000": 1, "0830-1200": 1 }, reglas: R, ahora: JUEVES_1000 }));
    expect(f["0830-1000"].estado).toEqual({ tipo: "quedan", quedan: 1, tope: 2 });
    expect(f["0830-1200"].estado).toEqual({ tipo: "llena", ocupadas: 1, tope: 1 });
    expect(f["0830-1730"].estado).toEqual({ tipo: "cuenta", ocupadas: 0 });
    expect(f["1200-1730"].estado).toEqual({ tipo: "libre" });
  });

  it("todo el día dice cuántas hay ese día y, con tope en Ajustes, se llena con todas juntas (D-NEXT)", () => {
    const ocupadas = { "0830-1000": 2, "0830-1200": 1, "0830-1730": 5 };
    const sinTope = porVentana(franjasDelDia({ fecha: MARTES, tienda: "Tienda Centro", ocupadas, reglas: R, ahora: JUEVES_1000 }));
    expect(sinTope["0830-1730"].estado).toEqual({ tipo: "cuenta", ocupadas: 5 });
    expect(textoDeFranja(sinTope["0830-1730"].estado, true)).toBe("5 órdenes ese día");
    const conTope = { ...R, cupo: { ...R.cupo, "0830-1730": 5 } };
    const lleno = porVentana(franjasDelDia({ fecha: MARTES, tienda: "Tienda Centro", ocupadas, reglas: conTope, ahora: JUEVES_1000 }));
    expect(lleno["0830-1730"].estado).toEqual({ tipo: "llena", ocupadas: 5, tope: 5 });
    const sinFlota = porVentana(franjasDelDia({ fecha: MARTES, tienda: "Tienda Lejos", ocupadas, reglas: R, ahora: JUEVES_1000 }));
    expect(sinFlota["0830-1730"].estado).toEqual({ tipo: "libre" });
  });

  it("lleno es justo al tope, no al pasarlo; y una de más sigue llena", () => {
    expect(estadoDeFranja("0830-1000", "Tienda Centro", { "0830-1000": 2 }, R)).toEqual({ tipo: "llena", ocupadas: 2, tope: 2 });
    expect(estadoDeFranja("0830-1000", "Tienda Centro", { "0830-1000": 3 }, R).tipo).toBe("llena");
    expect(estadoDeFranja("0830-1000", "Tienda Centro", { "0830-1000": 0 }, R)).toEqual({ tipo: "quedan", quedan: 2, tope: 2 });
    // Sin la ventana en el conteo es cero ocupadas, no «sin dato».
    expect(estadoDeFranja("0830-1000", "Tienda Centro", {}, R)).toEqual({ tipo: "quedan", quedan: 2, tope: 2 });
  });

  it("la tienda sin cupo ve todo libre aunque esté lleno (mayúsculas y espacios aparte)", () => {
    const f = franjasDelDia({ fecha: MARTES, tienda: "  tienda lejos ", ocupadas: { "0830-1000": 5, "0830-1200": 5 }, reglas: R, ahora: JUEVES_1000 });
    expect(f.map((x) => x.estado.tipo)).toEqual(["libre", "libre", "libre", "libre"]);
    expect(f.every((x) => x.motivos.length === 0)).toBe(true);
  });

  it("sin conteo (cargando o la ruta falló) se dice el tope y no se inventa lo ocupado", () => {
    const f = porVentana(franjasDelDia({ fecha: MARTES, tienda: "Tienda Centro", ocupadas: null, reglas: R, ahora: JUEVES_1000 }));
    expect(f["0830-1000"].estado).toEqual({ tipo: "sin_conteo", tope: 2 });
    expect(f["0830-1730"].estado).toEqual({ tipo: "libre" });
  });

  it("llena coincide con lo que dice D-639 (motivoPorCupo) en cada franja: no hay segunda regla", () => {
    const ocupadas = { "0830-1000": 2, "0830-1200": 0 };
    for (const tienda of ["Tienda Centro", "Tienda Lejos"]) {
      for (const f of franjasDelDia({ fecha: MARTES, tienda, ocupadas, reglas: R, ahora: JUEVES_1000 })) {
        const dice639 = motivoPorCupo({ store: tienda, delivery_windows: f.ventana }, ocupadas, R) != null;
        expect(f.estado.tipo === "llena", `${tienda} ${f.ventana}`).toBe(dice639);
        expect(f.motivos.some((m) => m.tipo === "cupo")).toBe(dice639);
      }
    }
  });
});

describe("hora de corte en las franjas", () => {
  it("antes del corte, para mañana, ninguna va a aprobación salvo la llena", () => {
    const f = porVentana(franjasDelDia({ fecha: "2026-10-23", tienda: "Tienda Centro", ocupadas: { "0830-1000": 2 }, reglas: R, ahora: JUEVES_1000 }));
    expect(f["0830-1000"].motivos.map((m) => m.tipo)).toEqual(["cupo"]);
    expect(f["0830-1200"].motivos).toEqual([]);
    expect(f["0830-1730"].motivos).toEqual([]);
  });

  it("pasado el corte, para mañana: solo las de la mañana; cada franja con SU ventana", () => {
    const f = porVentana(franjasDelDia({ fecha: "2026-10-23", tienda: "Tienda Centro", ocupadas: {}, reglas: R, ahora: JUEVES_1630, actual: "0830-1730" }));
    expect(f["0830-1000"].motivos.map((m) => m.tipo)).toEqual(["corte_manana"]);
    expect(f["0830-1200"].motivos.map((m) => m.tipo)).toEqual(["corte_manana"]);
    expect(f["0830-1730"].motivos).toEqual([]);
    expect(f["1200-1730"].motivos).toEqual([]);
  });

  it("pasado el corte, para hoy: todas", () => {
    const f = franjasDelDia({ fecha: "2026-10-22", tienda: "Tienda Centro", ocupadas: {}, reglas: R, ahora: JUEVES_1630 });
    expect(f.length).toBe(4);
    expect(f.every((x) => x.motivos.some((m) => m.tipo === "corte_hoy"))).toBe(true);
  });
});

describe("la consulta del conteo", () => {
  it("lleva la fecha (cambiarla cambia la consulta) y la propia orden a excluir", () => {
    expect(consultaDelCupo("2026-10-27", null, true)).toBe("/api/cupo-de-la-manana?fecha=2026-10-27");
    expect(consultaDelCupo("2026-10-28T00:00:00", "abc", true)).toBe("/api/cupo-de-la-manana?fecha=2026-10-28&excluir=abc");
  });

  it("no se pide sin fecha válida ni cuando la ficha no la necesita", () => {
    expect(consultaDelCupo("", null, true)).toBeNull();
    expect(consultaDelCupo("2026-10-27", null, false)).toBeNull();
  });
});

describe("textos", () => {
  it("lo que lee el vendedor", () => {
    expect(textoDeFranja({ tipo: "quedan", quedan: 1, tope: 2 }, true)).toBe("Queda 1 de 2");
    expect(textoDeFranja({ tipo: "quedan", quedan: 2, tope: 2 }, true)).toBe("Quedan 2 de 2");
    expect(textoDeFranja({ tipo: "quedan", quedan: 1, tope: 2 }, false)).toBe("1 of 2 left");
    expect(textoDeFranja({ tipo: "llena", ocupadas: 1, tope: 1 }, false)).toBe("Full (1 of 1)");
    expect(textoDeFranja({ tipo: "libre" }, true)).toBe("Libre");
    expect(nombreDeFranja("0830-1000", false)).toBe("Early Morning (8:30-10)");
    expect(nombreDeFranja("1300-1500", true)).toBe("13:00-15:00");
  });
});

// ---- La ruta ---------------------------------------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  filas: [] as Record<string, unknown>[],
  ajustes: null as null | Record<string, unknown>,
  columnas: [] as string[],
}));

function consulta(tabla: string) {
  const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
  const filas = () => (tabla === "settings" ? (h.ajustes ? [h.ajustes] : []) : h.filas).filter((r) => filtros.every((f) => f(r)));
  const q = {
    select: (c: string) => { h.columnas.push(`${tabla}:${c}`); return q; },
    eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return q; },
    in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return q; },
    maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: filas(), error: null }).then(ok, ko),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.usuario } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => consulta(t) }) }));

import { GET } from "@/app/api/cupo-de-la-manana/route";

const fila = (id: string, delivery_date: string, delivery_windows: string, extra: Record<string, unknown> = {}) =>
  ({ id, delivery_date, delivery_windows, store: "Tienda Centro", stage: "approved", is_training: false, customer_name: "Cliente Secreto", ...extra });

describe("la ruta que cuenta (/api/cupo-de-la-manana)", () => {
  beforeEach(() => { h.usuario = null; h.filas = []; h.ajustes = null; h.columnas = []; });

  it("sin sesión, 401 y no lee nada", async () => {
    h.filas = [fila("a", MARTES, "0830-1000")];
    const r = await GET(new Request(`http://x/api/cupo-de-la-manana?fecha=${MARTES}`));
    expect(r.status).toBe(401);
    expect(h.columnas).toEqual([]);
  });

  it("con sesión devuelve solo cuentas por franja con cupo: ni filas, ni clientes", async () => {
    h.usuario = { id: "u1" };
    h.filas = [
      fila("a", MARTES, "0830-1000"), fila("b", MARTES, "0830-1000"), fila("c", MARTES, "0830-1200"),
      fila("d", MARTES, "0830-1730"),                                   // sin cupo propio, pero «todo el día» suma todas
      fila("e", "2026-10-28", "0830-1000"),                              // otro día
      fila("f", MARTES, "0830-1000", { store: "RDZ Brownsville" }),      // tienda sin cupo por defecto
      fila("g", MARTES, "0830-1200", { stage: "canceled" }),             // anulada
    ];
    const r = await GET(new Request(`http://x/api/cupo-de-la-manana?fecha=${MARTES}&excluir=b`));
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo).toEqual({ ocupadas: { "0830-1000": 1, "0830-1200": 1, "0830-1730": 3, "0830-1530": 3 } });
    expect(JSON.stringify(cuerpo)).not.toContain("Cliente Secreto");
    expect(h.columnas).toContain("deliveries:id, store, delivery_windows, stage, is_training");
  });

  it("las franjas con cupo salen de Ajustes: una nueva se cuenta también", async () => {
    h.usuario = { id: "u1" };
    h.ajustes = { id: 1, approval_rules: { cupo: { "0830-1000": 2, "1200-1730": 1 }, tiendas_sin_cupo: [] } };
    h.filas = [fila("a", MARTES, "1200-1730"), fila("b", MARTES, "0830-1200")];
    const cuerpo = await (await GET(new Request(`http://x/api/cupo-de-la-manana?fecha=${MARTES}`))).json();
    expect(cuerpo).toEqual({ ocupadas: { "0830-1000": 0, "1200-1730": 1, "0830-1730": 2, "0830-1530": 2 } });
  });

  it("fecha mala, 400", async () => {
    h.usuario = { id: "u1" };
    expect((await GET(new Request("http://x/api/cupo-de-la-manana?fecha=mañana"))).status).toBe(400);
  });
});

// ---- La tarjeta ------------------------------------------------------------------------------------------------------

import { FranjasDelDia } from "@/components/FranjasDelDia";

type Props = Parameters<typeof FranjasDelDia>[0];
const botones = (n: ReactNode): ReactElement<{ onClick?: () => void; disabled?: boolean; "data-franja"?: string }>[] => {
  if (Array.isArray(n)) return n.flatMap(botones);
  if (!isValidElement(n)) return [];
  const el = n as ReactElement<{ children?: ReactNode }>;
  return [...(el.type === "button" ? [el as never] : []), ...botones(el.props.children)];
};

describe("la tarjeta de franjas", () => {
  const franjas = franjasDelDia({ fecha: MARTES, tienda: "Tienda Centro", ocupadas: { "0830-1000": 1, "0830-1200": 1 }, reglas: R, ahora: JUEVES_1000 });
  const base: Props = { franjas, actual: "0830-1730", onElige: null, vaAAprobacion: (m) => m.length > 0, tiendaFuera: null, es: true };

  it("pulsar una franja la elige como ventana (la llena también: no se esconde)", () => {
    const elegidas: string[] = [];
    const bs = botones(FranjasDelDia({ ...base, onElige: (v) => elegidas.push(v) }));
    expect(bs.map((b) => b.props["data-franja"])).toEqual(["0830-1000", "0830-1200", "0830-1730", "1200-1730"]);
    bs[1].props.onClick?.();
    bs[3].props.onClick?.();
    expect(elegidas).toEqual(["0830-1200", "1200-1730"]);
  });

  it("enseña lo que queda, la llena como llena, y avisa de aprobación solo donde la ficha dice que cambia algo", () => {
    const html = renderToStaticMarkup(createElement(FranjasDelDia, base));
    expect(html).toContain("Queda 1 de 2");
    expect(html).toContain("Llena (1 de 1)");
    expect(html.match(/data-va-a-aprobacion/g)?.length).toBe(1);
    // Quien crea como oficina no va a aprobación: la misma franja llena, sin aviso.
    expect(renderToStaticMarkup(createElement(FranjasDelDia, { ...base, vaAAprobacion: () => false }))).not.toContain("data-va-a-aprobacion");
  });

  it("solo mirar: sin onElige los botones van deshabilitados", () => {
    expect(botones(FranjasDelDia(base)).every((b) => b.props.disabled === true)).toBe(true);
  });

  it("sin franjas no pinta nada", () => {
    expect(renderToStaticMarkup(createElement(FranjasDelDia, { ...base, franjas: [] }))).toBe("");
  });
});

// ---- Cómo la cablea la ficha -----------------------------------------------------------------------------------------

describe("la ficha de la orden", () => {
  const src = readFileSync("src/components/OrderModal.tsx", "utf8").replace(/\r\n/g, "\n");

  it("pulsar una franja escribe la ventana de la orden, y solo quien puede tocar la ventana", () => {
    expect(src).toContain('onElige={salesFields ? (v) => set("delivery_windows", v) : null}');
    // En «solo la fecha» (D-480) la ventana no se guarda: la tarjeta es solo para mirar.
    const soloFecha = src.slice(src.indexOf("{/* ---------- SOLO LA FECHA"), src.indexOf("{/* ---------- EDIT MODE"));
    expect(soloFecha).toContain("<FranjasDelDia");
    expect(soloFecha).toContain("onElige={null}");
  });

  it("el conteo se pide también para las franjas, no solo cuando la ventana elegida tiene cupo", () => {
    expect(src).toContain("consultaDelCupo(fechaDeCupo, existing?.id, miraCupo || muestraFranjas)");
    // La consulta lleva la fecha: el efecto depende de ella, así que cambiar la fecha vuelve a contar.
    expect(src).toMatch(/void cuentaElCupo\(\)\.then[\s\S]{0,120}\}, \[urlDelCupo, cuentaElCupo\]\);/);
  });

  it("el aviso de aprobación de cada franja es el mismo que el de la orden (D-639)", () => {
    expect(src).toContain("const avisaMotivos = cambiaLaAprobacion(motivosDeOficina);");
    expect(src).toContain("vaAAprobacion={(m) => aunNoSale && cambiaLaAprobacion(m)}");
  });
});
