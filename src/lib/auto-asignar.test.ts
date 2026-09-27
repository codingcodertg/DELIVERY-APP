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
  resumenDelReparto,
  todosLosChoferes,
  type ResultadoDelReparto,
} from "./auto-asignar";

/** El diálogo de «✨ Auto-asignar» del Gestor de Rutas (D-401). Desde D-NEXT reparte el motor: sus pruebas, con días
 *  reales, en `route-plan/reparto.test.ts`. */

const CHOFERES = ["Diego Driver", "Carlos R.", "Miguel A.", "Fleet Truck 3"];
const opciones = (filtro = "", noDisponibles: string[] = []) => opcionesDeConductor({
  rutas: CHOFERES.map((c) => ({ clave: c, etiqueta: c, esRuta: false })),
  paradasDe: () => 0,
  palletsDe: () => 0,
  capacidadDe: () => 12,
  noDisponibles: new Set(noDisponibles),
  filtro,
});

const orden = (n: number, over: Partial<Delivery> = {}) =>
  mkDelivery({ id: `o${n}`, order_no: 1000 + n, delivery_lat: 26.1 + n * 0.03, delivery_lng: -98.3 + (n % 3) * 0.05, est_pallets: 2, delivery_date: "2026-09-25", ...over });

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

describe("el resumen al terminar", () => {
  const porId = new Map([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`o${n}`, orden(n)]));
  const et = (d: Delivery) => String(d.order_no);
  const r: ResultadoDelReparto = {
    colocadas: [{ id: "o3", chofer: "A" }, { id: "o4", chofer: "B" }, { id: "o5", chofer: "A" }],
    sinColocar: [{ id: "o1", motivo: "no_cabe_con_el_resto" }, { id: "o2", motivo: "sin_punto" }],
    noEscritas: [], reordenadas: 0, choferesFuera: [], dias: ["2026-09-25"],
  };
  it("dice cuántas, a cuántos choferes, y cada una que no se colocó CON SU PORQUÉ (el del motor)", () => {
    expect(resumenDelReparto(r, (id) => porId.get(id), et).es).toBe("Auto-asignadas 3 orden(es) a 2 chofer(es) · 2 sin colocar: #1001 (hoy no queda sitio), #1002 (sin punto en el mapa).");
    expect(resumenDelReparto(r, (id) => porId.get(id), et).en).toBe("Auto-assigned 3 order(s) to 2 driver(s) · 2 not placed: #1001 (no room left today), #1002 (no map point).");
  });
  it("dice qué choferes quedaron fuera y por qué, y en cuántos días se repartió", () => {
    const x = { ...r, sinColocar: [], choferesFuera: [{ nombre: "Chofer D", motivo: "no_rutea" }, { nombre: "Ana", motivo: "no_disponible" }], dias: ["2026-09-25", "2026-09-26"] };
    expect(resumenDelReparto(x, (id) => porId.get(id), et).es).toBe("Auto-asignadas 3 orden(es) a 2 chofer(es) en 2 días · Quedaron fuera: Chofer D (no rutea), Ana (hoy no está).");
  });
  it("con muchas sueltas enseña seis y cuántas más", () => {
    const x = { ...r, sinColocar: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `o${n}`, motivo: "no_cabe_con_el_resto" as const })) };
    expect(resumenDelReparto(x, (id) => porId.get(id), et).es).toContain("#1006 (hoy no queda sitio) +2.");
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
    expect(pagina).toContain("const opcionesDelReparto = opcionesDeConductor({ rutas: drivers.filter((u) => !bloqueada(u.full_name)).map((u) => ({ clave: u.full_name, etiqueta: u.full_name, esRuta: false })), paradasDe: (k) => (byDriver.get(k) ?? []).length, palletsDe: (k) => sumaPallets(byDriver.get(k) ?? []), capacidadDe: (k) => capacityFor(k), noDisponibles: unavailableToday, filtro: filtroChofer, });");
    expect(pagina).toContain("{dialogoAutoAsignar && ( <AutoAsignarDialogo opciones={opcionesDelReparto} delDia={unassigned.length} marcadas={poolSelectedCount}");
    expect(pagina).toContain("onCancelar={() => setDialogoAutoAsignar(false)} onConfirmar={repartirConElDialogo}");
  });
  it("reparte con el MOTOR (`repartirConElMotor`), solo entre los elegidos, y escribe solo si la orden no cambió (D-NEXT)", () => {
    const cuerpo = pagina.slice(pagina.indexOf("const repartirConElDialogo = async"), pagina.indexOf("const toggleOrder ="));
    expect(cuerpo).toContain("const ordenes = ordenesDelReparto(e.alcance, unassigned, marcadas);");
    expect(cuerpo).toContain("r = await repartirConElMotor({ ordenes, choferes: e.choferes.filter((c) => !bloqueada(c)), pide: pideElReparto(SIN_BASE, () => ({ deliveries, users, settings, availability, bloqueadas: (f) => bloqueos[f] ?? [] })), escribe: (w) => { clearRouteFor(w.chofer); return updateDelivery(w.id, w.patch, { quiet: true, siNoCambioDesde: w.updated_at || undefined }); }, });");
    expect(cuerpo).toContain("setDialogoAutoAsignar(false);");
    expect(cuerpo).toContain("const resumen = resumenDelReparto(r, (id) => porId.get(id), orderLabel); notify(t(resumen.en, resumen.es));");
    // Lo colocado sale de la selección; lo que no, sigue marcado.
    expect(cuerpo).toContain("if (colocadas.size) setSelectedOrders((s) => new Set([...s].filter((id) => !colocadas.has(id))));");
    // Y NO pasa después por «Optimizar ruta»: desharía el orden que dejó el motor.
    expect(cuerpo).not.toMatch(/computeRoute|optimizaEstas|applyPlan|assignTo\(/);
  });
  it("«Optimizar todas las rutas» y el diálogo optimizan por el mismo bucle, con las paradas que se le dan", () => {
    expect(pagina).toContain("const optimizeAll = () => optimizaEstas(lanes.filter((u) => (byDriver.get(u.key) ?? []).length > 0).map((u) => ({ clave: u.key, paradas: byDriver.get(u.key) ?? [] })));");
    expect(pagina).toContain("optimizaUna: async (r) => { setBusyDriver(r.clave); await applyPlan(r.clave, await computeRoute(r.clave, r.paradas)); },");
    expect(pagina).toContain("if (aviso) notify(t(`${aviso.en} Optimized ${bien.length}.`, `${aviso.es} Optimizadas ${bien.length}.`)); return bien; };");
  });

  it("el diálogo nace con `alcanceInicial` y `choferesIniciales`, y ya no ofrece «Optimizar al terminar» (D-NEXT)", () => {
    expect(dialogo).toContain("useState<AlcanceDelReparto>(() => alcanceInicial(marcadas))");
    expect(dialogo).toContain("useState<Set<string>>(() => choferesIniciales(opciones))");
    expect(dialogo).not.toMatch(/data-optimizar-al-terminar|setOptimizar|data-asignar-y-optimizar/);
    expect(dialogo).toContain("data-como-reparte");
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
    expect(dialogo).toContain("data-asignar-del-dialogo disabled={!puede}");
    expect(dialogo).toContain("onConfirmar({ alcance, choferes: opciones.filter((o) => elegidos.has(o.clave)).map((o) => o.clave) })");
  });
  it("cancelar (✕, «Cancelar» o clic fuera) solo cierra", () => {
    expect(dialogo).toContain("data-cancelar-dialogo onClick={onCancelar}");
    expect(dialogo).toContain("data-cerrar-dialogo onClick={onCancelar}");
    expect(dialogo).toContain("if (e.target === e.currentTarget && abajoEnElFondo.current) onCancelar();");
  });
});
