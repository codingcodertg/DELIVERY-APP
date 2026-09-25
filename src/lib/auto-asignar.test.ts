import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkDelivery } from "@/lib/__fixtures";
import type { Delivery } from "@/lib/types";
import { opcionesDeConductor } from "./elige-conductor";
import {
  alcanceInicial,
  choferesIniciales,
  ordenesDelReparto,
  puedeRepartir,
  repartirYOptimizar,
  resumenDelReparto,
  todosLosChoferes,
  type RutaQueOptimizar,
} from "./auto-asignar";

/** El diálogo de «✨ Auto-asignar» del Gestor de Rutas (D-401). */

const CHOFERES = ["Diego Driver", "Carlos R.", "Miguel A.", "Fleet Truck 3"];
const opciones = (filtro = "", noDisponibles: string[] = []) => opcionesDeConductor({
  rutas: CHOFERES.map((c) => ({ clave: c, etiqueta: c, esRuta: false })),
  paradasDe: () => 0,
  palletsDe: () => 0,
  capacidadDe: () => 12,
  noDisponibles: new Set(noDisponibles),
  filtro,
});

// Órdenes repartidas por el valle, sin ventana, 2 pallets: con cuatro choferes libres el reparto las extiende.
const orden = (n: number, over: Partial<Delivery> = {}) =>
  mkDelivery({ id: `o${n}`, order_no: 1000 + n, delivery_lat: 26.1 + n * 0.03, delivery_lng: -98.3 + (n % 3) * 0.05, est_pallets: 2, delivery_date: "2026-09-25", ...over });
const ORDENES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => orden(n));

/** Un stub de asignar y de optimizar: no sale nada de la máquina, y se cuentan las llamadas. */
function stubs() {
  const asignadas: { id: string; chofer: string }[] = [];
  const optimizaciones: RutaQueOptimizar[][] = [];
  return {
    asignadas,
    optimizaciones,
    asigna: async (id: string, chofer: string) => { asignadas.push({ id, chofer }); },
    optimiza: async (rutas: RutaQueOptimizar[]) => { optimizaciones.push(rutas); return rutas.map((r) => r.clave); },
  };
}
const PREVIAS: Record<string, Delivery[]> = { "Carlos R.": [orden(50, { assigned_driver: "Carlos R." })] };
const base = (s: ReturnType<typeof stubs>, over: Partial<Parameters<typeof repartirYOptimizar>[0]> = {}) => ({
  ordenes: ORDENES,
  choferes: CHOFERES,
  capacidadDe: () => 12,
  noDisponibles: new Set<string>(),
  optimizar: true,
  paradasDe: (k: string) => PREVIAS[k] ?? [],
  esDelDia: (d: Delivery) => d.delivery_date === "2026-09-25",
  asigna: s.asigna,
  optimiza: s.optimiza,
  ...over,
});

describe("qué órdenes", () => {
  it("con marcadas nace en «Solo las marcadas»; sin ninguna, en «Todas»", () => {
    expect(alcanceInicial(3)).toBe("marcadas");
    expect(alcanceInicial(0)).toBe("todas");
  });
  it("«Todas» son las del día; «Solo las marcadas», las marcadas", () => {
    const dia = [orden(1), orden(2)], marcadas = [orden(9)];
    expect(ordenesDelReparto("todas", dia, marcadas).map((d) => d.id)).toEqual(["o1", "o2"]);
    expect(ordenesDelReparto("marcadas", dia, marcadas).map((d) => d.id)).toEqual(["o9"]);
  });
});

describe("qué choferes nacen marcados", () => {
  it("sin filtro, todos los disponibles; el no disponible nunca", () => {
    expect([...choferesIniciales(opciones("", ["Miguel A."]))]).toEqual(["Diego Driver", "Carlos R.", "Fleet Truck 3"]);
  });
  it("con el filtro en un chofer disponible, solo ese", () => {
    expect([...choferesIniciales(opciones("Carlos R."))]).toEqual(["Carlos R."]);
  });
  it("con el filtro en un chofer no disponible, todos los disponibles (no uno que no se puede marcar)", () => {
    expect([...choferesIniciales(opciones("Carlos R.", ["Carlos R."]))]).toEqual(["Diego Driver", "Miguel A.", "Fleet Truck 3"]);
  });
  it("«Todos» marca los disponibles y deja fuera al no disponible", () => {
    expect([...todosLosChoferes(opciones("", ["Diego Driver"]))]).toEqual(["Carlos R.", "Miguel A.", "Fleet Truck 3"]);
  });
  it("el botón se apaga sin choferes marcados, o sin órdenes que repartir", () => {
    expect(puedeRepartir(new Set(), 5)).toBe(false);
    expect(puedeRepartir(new Set(["Diego Driver"]), 0)).toBe(false);
    expect(puedeRepartir(new Set(["Diego Driver"]), 1)).toBe(true);
  });
});

describe("repartir y optimizar (con el optimizador stubbeado)", () => {
  it("control: con los cuatro choferes el reparto usa más de dos", async () => {
    const s = stubs();
    await repartirYOptimizar(base(s));
    expect(new Set(s.asignadas.map((a) => a.chofer)).size).toBeGreaterThan(2);
  });
  it("con 2 de 4 marcados, las órdenes van SOLO a esos 2, y se optimiza una vez con SOLO esas 2 rutas", async () => {
    const s = stubs();
    const r = await repartirYOptimizar(base(s, { choferes: ["Carlos R.", "Fleet Truck 3"] }));
    expect(s.asignadas).toHaveLength(8);
    expect(new Set(s.asignadas.map((a) => a.chofer))).toEqual(new Set(["Carlos R.", "Fleet Truck 3"]));
    expect(s.optimizaciones).toHaveLength(1);
    expect(s.optimizaciones[0].map((x) => x.clave).sort()).toEqual(["Carlos R.", "Fleet Truck 3"]);
    expect(r.optimizadas.sort()).toEqual(["Carlos R.", "Fleet Truck 3"]);
  });
  it("una ruta cuyo optimizar falla queda pedida pero NO optimizada (lo que devuelve el optimizador manda)", async () => {
    const s = stubs();
    const r = await repartirYOptimizar(base(s, { choferes: ["Carlos R.", "Fleet Truck 3"], optimiza: async (rutas) => { s.optimizaciones.push(rutas); return ["Carlos R."]; } }));
    expect(r.pedidas.sort()).toEqual(["Carlos R.", "Fleet Truck 3"]);
    expect(r.optimizadas).toEqual(["Carlos R."]);
  });
  it("cada ruta que se optimiza lleva sus paradas de antes MÁS las que acaba de recibir, ya con su chofer", async () => {
    const s = stubs();
    await repartirYOptimizar(base(s, { choferes: ["Carlos R.", "Fleet Truck 3"] }));
    const carlos = s.optimizaciones[0].find((x) => x.clave === "Carlos R.")!;
    const recibidas = s.asignadas.filter((a) => a.chofer === "Carlos R.").map((a) => a.id);
    expect(carlos.paradas.map((d) => d.id)).toEqual(["o50", ...recibidas]);
    expect(carlos.paradas.every((d) => d.assigned_driver === "Carlos R.")).toBe(true);
  });
  it("solo optimiza a quien recibió algo: un marcado que no recibe nada no se optimiza", async () => {
    const s = stubs();
    // Una sola orden: la recibe uno de los dos.
    await repartirYOptimizar(base(s, { ordenes: [orden(1)], choferes: ["Carlos R.", "Fleet Truck 3"] }));
    expect(s.asignadas).toHaveLength(1);
    expect(s.optimizaciones[0].map((x) => x.clave)).toEqual([s.asignadas[0].chofer]);
  });
  it("una orden de otro día (marcada con el chip «Todas») se asigna, pero no entra en la ruta de este día", async () => {
    const s = stubs();
    await repartirYOptimizar(base(s, { ordenes: [orden(1, { delivery_date: "2026-09-30" })], choferes: ["Carlos R."] }));
    expect(s.asignadas).toEqual([{ id: "o1", chofer: "Carlos R." }]);
    expect(s.optimizaciones).toHaveLength(0);
  });
  it("sin «Optimizar las rutas al terminar», asigna y no llama al optimizador", async () => {
    const s = stubs();
    const r = await repartirYOptimizar(base(s, { optimizar: false, choferes: ["Diego Driver"] }));
    expect(s.asignadas.length).toBeGreaterThan(0);
    expect(s.optimizaciones).toHaveLength(0);
    expect(r.optimizadas).toEqual([]);
  });
  it("un marcado que ese día no está disponible no recibe nada", async () => {
    const s = stubs();
    await repartirYOptimizar(base(s, { choferes: ["Diego Driver", "Carlos R."], noDisponibles: new Set(["Diego Driver"]) }));
    expect(new Set(s.asignadas.map((a) => a.chofer))).toEqual(new Set(["Carlos R."]));
  });
  it("lo que no cabe o no tiene ubicación queda sin colocar, y no se llama al optimizador si no se asignó nada", async () => {
    const s = stubs();
    const r = await repartirYOptimizar(base(s, { ordenes: [orden(1, { delivery_lat: null, delivery_lng: null })] }));
    expect(r.reparto.unassigned.map((d) => d.id)).toEqual(["o1"]);
    expect(s.asignadas).toHaveLength(0);
    expect(s.optimizaciones).toHaveLength(0);
  });
});

describe("el resumen al terminar", () => {
  const sueltas = [orden(1), orden(2)];
  const r = { reparto: { assignments: [{ orderId: "o3", driver: "A" }, { orderId: "o4", driver: "B" }, { orderId: "o5", driver: "A" }], unassigned: sueltas }, pedidas: ["A", "B"], optimizadas: ["A", "B"] };
  const et = (d: Delivery) => String(d.order_no);
  it("dice cuántas, a cuántos choferes, qué no se colocó (con sus números) y cuántas rutas se optimizaron", () => {
    expect(resumenDelReparto(r, et, true).es).toBe("Auto-asignadas 3 orden(es) a 2 chofer(es) · 2 sin colocar (sin ubicación, sin capacidad o con la ventana ya ocupada): #1001, #1002 · 2 ruta(s) optimizada(s).");
    expect(resumenDelReparto(r, et, true).en).toBe("Auto-assigned 3 order(s) to 2 driver(s) · 2 not placed (no location, no room or window already taken): #1001, #1002 · 2 route(s) optimized.");
  });
  it("sin optimizar lo dice; y sin sueltas no las menciona", () => {
    expect(resumenDelReparto({ ...r, reparto: { ...r.reparto, unassigned: [] }, pedidas: [], optimizadas: [] }, et, false).es).toBe("Auto-asignadas 3 orden(es) a 2 chofer(es). Rutas sin optimizar.");
  });
  it("si una ruta falló al optimizar, dice cuántas de cuántas (medido en el demo: sin sesión, las 4 contestan 401)", () => {
    const fallo = { ...r, reparto: { ...r.reparto, unassigned: [] }, optimizadas: ["A"] };
    expect(resumenDelReparto(fallo, et, true).es).toBe("Auto-asignadas 3 orden(es) a 2 chofer(es) · 1 de 2 ruta(s) optimizada(s) (1 con error).");
    expect(resumenDelReparto(fallo, et, true).en).toBe("Auto-assigned 3 order(s) to 2 driver(s) · 1 of 2 route(s) optimized (1 failed).");
  });
  it("con muchas sueltas enseña seis números y cuántas más", () => {
    const muchas = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => orden(n));
    expect(resumenDelReparto({ ...r, reparto: { ...r.reparto, unassigned: muchas } }, et, true).es).toContain(": #1001, #1002, #1003, #1004, #1005, #1006 +2 ·");
  });
});

describe("la pantalla del Gestor usa el diálogo y estas funciones", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  const pagina = leer("src/app/(app)/routes/page.tsx");
  const dialogo = leer("src/components/AutoAsignarDialogo.tsx");

  it("«✨ Auto-asignar» de arriba ya no reparte: abre el diálogo", () => {
    expect(pagina).toContain("data-auto-asignar disabled={autoAssigning || optimizingAll || busyDriver != null || (unassigned.length === 0 && poolSelectedCount === 0) || drivers.length === 0} onClick={() => setDialogoAutoAsignar(true)}");
    expect(pagina).not.toContain("runAutoAssign");
  });
  it("«Auto-asignar las marcadas» del recuadro abre el MISMO diálogo (un solo camino)", () => {
    expect(pagina).toContain("data-auto-asignar-del-recuadro onClick={() => setDialogoAutoAsignar(true)}");
    expect(pagina).not.toContain("bulkAutoAssign");
  });
  it("el diálogo recibe los choferes de verdad (sin rutas temporales), el día sin asignar y las marcadas", () => {
    expect(pagina).toContain("const opcionesDelReparto = opcionesDeConductor({ rutas: drivers.map((u) => ({ clave: u.full_name, etiqueta: u.full_name, esRuta: false })), paradasDe: (k) => (byDriver.get(k) ?? []).length, palletsDe: (k) => sumaPallets(byDriver.get(k) ?? []), capacidadDe: (k) => capacityFor(k), noDisponibles: unavailableToday, filtro: filtroChofer, });");
    expect(pagina).toContain("{dialogoAutoAsignar && ( <AutoAsignarDialogo opciones={opcionesDelReparto} delDia={unassigned.length} marcadas={poolSelectedCount}");
    expect(pagina).toContain("onCancelar={() => setDialogoAutoAsignar(false)} onConfirmar={repartirConElDialogo}");
  });
  it("reparte con `repartirYOptimizar`, solo entre los elegidos, y optimiza con el bucle de «Optimizar todas las rutas»", () => {
    const cuerpo = pagina.slice(pagina.indexOf("const repartirConElDialogo = async"), pagina.indexOf("const toggleOrder ="));
    expect(cuerpo).toContain("const ordenes = ordenesDelReparto(e.alcance, unassigned, marcadas);");
    expect(cuerpo).toContain("r = await repartirYOptimizar({ ordenes, choferes: e.choferes, capacidadDe: capacityFor, noDisponibles: unavailableToday, optimizar: e.optimizar, paradasDe: (k) => byDriver.get(k) ?? [], esDelDia: (d) => delDia.has(d.id), asigna: (id, chofer) => assignTo(id, chofer), optimiza: optimizaEstas, });");
    expect(cuerpo).toContain("const delDia = new Set(dayOrders.map((d) => d.id));");
    expect(cuerpo).toContain("setDialogoAutoAsignar(false);");
    expect(cuerpo).toContain("const resumen = resumenDelReparto(r, orderLabel, e.optimizar); notify(t(resumen.en, resumen.es));");
    expect(cuerpo).toContain("if (e.alcance === \"marcadas\") clearSelection();");
  });
  it("«Optimizar todas las rutas» y el diálogo optimizan por el mismo bucle, con las paradas que se le dan", () => {
    expect(pagina).toContain("const optimizeAll = () => optimizaEstas(lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0).map((u) => ({ clave: u.key, paradas: byDriver.get(u.key) ?? [] })));");
    expect(pagina).toContain("await applyPlan(r.clave, await computeRoute(r.clave, r.paradas)); bien.push(r.clave); } catch (e) {");
    expect(pagina).toContain("setRouterInfo(lastProviderRef.current); return bien; };");
  });

  it("el diálogo nace con `alcanceInicial`, `choferesIniciales` y «Optimizar» marcado", () => {
    expect(dialogo).toContain("useState<AlcanceDelReparto>(() => alcanceInicial(marcadas))");
    expect(dialogo).toContain("useState<Set<string>>(() => choferesIniciales(opciones))");
    expect(dialogo).toContain("const [optimizar, setOptimizar] = useState(true);");
  });
  it("«Solo las marcadas» sale solo con marcadas; los no disponibles, desactivados", () => {
    expect(dialogo).toContain("{marcadas > 0 && ( <label style={radio}> <input type=\"radio\" name=\"alcance-del-reparto\" data-alcance=\"marcadas\"");
    expect(dialogo).toContain("checked={elegidos.has(o.clave)} disabled={!seMarca(o)}");
  });
  it("«Todos», «Ninguno», y el botón que se apaga con `puedeRepartir`", () => {
    expect(dialogo).toContain("data-todos-los-choferes onClick={() => setElegidos(todosLosChoferes(opciones))}");
    expect(dialogo).toContain("data-ningun-chofer onClick={() => setElegidos(new Set())}");
    expect(dialogo).toContain("const puede = puedeRepartir(elegidos, cuantas);");
    expect(dialogo).toContain("const cuantas = alcance === \"marcadas\" ? marcadas : delDia;");
    expect(dialogo).toContain("data-asignar-y-optimizar disabled={!puede}");
    expect(dialogo).toContain("onConfirmar({ alcance, choferes: opciones.filter((o) => elegidos.has(o.clave)).map((o) => o.clave), optimizar })");
  });
  it("cancelar (✕, «Cancelar» o clic fuera) solo cierra", () => {
    expect(dialogo).toContain("data-cancelar-dialogo onClick={onCancelar}");
    expect(dialogo).toContain("data-cerrar-dialogo onClick={onCancelar}");
    expect(dialogo).toContain("if (e.target === e.currentTarget && abajoEnElFondo.current) onCancelar();");
  });
});
