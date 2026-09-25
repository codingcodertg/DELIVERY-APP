import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eleccionVigente, opcionesDeConductor, type RutaAsignable } from "./elige-conductor";

/** «Elige conductor para N órdenes» en «Sin asignar» del Gestor de Rutas (D-395). */

const RUTAS: RutaAsignable[] = [
  { clave: "Diego Driver", etiqueta: "Diego Driver", esRuta: false },
  { clave: "Carlos R.", etiqueta: "Carlos R.", esRuta: false },
  { clave: "Maximo Garza", etiqueta: "Maximo Garza", esRuta: false },
  { clave: "Route 1", etiqueta: "Route 1", esRuta: true },
];
const PARADAS: Record<string, number> = { "Diego Driver": 4, "Carlos R.": 2, "Maximo Garza": 0, "Route 1": 1 };
const PALLETS: Record<string, number> = { "Diego Driver": 7.5, "Carlos R.": 3, "Maximo Garza": 0, "Route 1": 1 };
const opciones = (filtro = "", noDisponibles: string[] = []) => opcionesDeConductor({
  rutas: RUTAS,
  paradasDe: (k) => PARADAS[k] ?? 0,
  palletsDe: (k) => PALLETS[k] ?? 0,
  capacidadDe: (k) => (k === "Carlos R." ? 12 : 26),
  noDisponibles: new Set(noDisponibles),
  filtro,
});

describe("las opciones del recuadro", () => {
  it("salen todos los choferes y rutas, en el orden del panel, cada uno con SUS paradas y SUS pallets/capacidad", () => {
    const o = opciones();
    expect(o.map((x) => x.clave)).toEqual(["Diego Driver", "Carlos R.", "Maximo Garza", "Route 1"]);
    expect(o.map((x) => [x.paradas, x.pallets, x.capacidad])).toEqual([[4, 7.5, 26], [2, 3, 12], [0, 0, 26], [1, 1, 26]]);
    expect(o.map((x) => x.esRuta)).toEqual([false, false, false, true]);
    expect(o.some((x) => x.delFiltro)).toBe(false);
  });
  it("con filtro de chofer salen TODOS igual, pero el del filtro va primero y marcado", () => {
    const o = opciones("Maximo Garza");
    expect(o.map((x) => x.clave)).toEqual(["Maximo Garza", "Diego Driver", "Carlos R.", "Route 1"]);
    expect(o.map((x) => x.delFiltro)).toEqual([true, false, false, false]);
  });
  it("el que no está disponible ese día sale, marcado (asignarle a mano es decisión de quien asigna)", () => {
    const o = opciones("", ["Carlos R."]);
    expect(o.map((x) => x.noDisponible)).toEqual([false, true, false, false]);
  });
  it("sin choferes ni rutas, no hay opciones", () => {
    expect(opcionesDeConductor({ rutas: [], paradasDe: () => 0, palletsDe: () => 0, capacidadDe: () => 26, noDisponibles: new Set(), filtro: "" })).toEqual([]);
  });
});

describe("cuál está elegido", () => {
  it("sin nada pulsado y sin filtro, ninguno: «Asignar» nace apagado", () => {
    expect(eleccionVigente(null, opciones())).toBeNull();
  });
  it("sin nada pulsado y con filtro, el del filtro", () => {
    expect(eleccionVigente(null, opciones("Carlos R."))).toBe("Carlos R.");
  });
  it("lo pulsado manda sobre el filtro", () => {
    expect(eleccionVigente("Route 1", opciones("Carlos R."))).toBe("Route 1");
  });
  it("lo pulsado que ya no está entre las opciones no cuenta", () => {
    expect(eleccionVigente("Se fue", opciones())).toBeNull();
    expect(eleccionVigente("Se fue", opciones("Diego Driver"))).toBe("Diego Driver");
  });
});

describe("la pantalla del Gestor pinta el recuadro con estas funciones", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("las opciones salen de `opcionesDeConductor`, con los choferes, las rutas temporales, el 📦 y los pallets del panel, y el filtro de arriba", () => {
    expect(pagina).toContain("const opcionesDelRecuadro = opcionesDeConductor({ rutas: [ ...drivers.map((u) => ({ clave: u.full_name, etiqueta: u.full_name, esRuta: false })), ...bucketNames.map((n) => ({ clave: n, etiqueta: n, esRuta: true })), ],");
    expect(pagina).toContain("paradasDe: (k) => (byDriver.get(k) ?? []).length, palletsDe: (k) => sumaPallets(byDriver.get(k) ?? []), capacidadDe: (k) => capacityFor(k), noDisponibles: unavailableToday, filtro: filtroChofer, });");
    expect(pagina).toContain("const conductorElegido = eleccionVigente(conductorPulsado, opcionesDelRecuadro);");
  });
  it("el recuadro sale solo con órdenes marcadas, dice cuántas, y pinta cada opción con sus números", () => {
    expect(pagina).toContain("{poolSelectedCount > 0 && ( <div className=\"card\" data-elige-conductor");
    expect(pagina).toContain("`Elige conductor para ${poolSelectedCount} órdenes`");
    expect(pagina).toContain("{opcionesDelRecuadro.map((o) => (");
    expect(pagina).toContain("checked={o.clave === conductorElegido} onChange={() => setConductorPulsado(o.clave)}");
    expect(pagina).toContain("`${o.paradas} paradas`)} · {o.pallets}/{o.capacidad}");
  });
  it("va DESPUÉS de la tabla y pegado abajo (`sticky`): arriba quedaba debajo del mapa, que también es `sticky`", () => {
    const menu = pagina.indexOf("<MenuDeColumnaAbierto estado={ordenSinAsignar}");
    expect(menu).toBeGreaterThan(-1);
    expect(pagina.indexOf("data-elige-conductor role=\"group\"")).toBeGreaterThan(menu);
    expect(pagina).toContain("style={{ position: \"sticky\", bottom: 8, zIndex: 6,");
  });
  it("sin choferes lo dice, en vez de un recuadro vacío", () => {
    expect(pagina).toContain("{opcionesDelRecuadro.length === 0 ? ( <div className=\"hint\" data-sin-choferes");
  });
  it("«Asignar» se apaga sin elegido y usa `bulkAssign`; «Nueva ruta» y «Auto-asignar» siguen dentro", () => {
    expect(pagina).toContain("data-asignar-al-elegido disabled={!conductorElegido || autoAssigning} onClick={() => { if (conductorElegido) bulkAssign(conductorElegido); }}");
    expect(pagina).toContain("data-nueva-ruta-del-recuadro disabled={autoAssigning} onClick={() => bulkAssign(addBucket())}");
    // Desde D-NEXT «Auto-asignar las marcadas» abre el diálogo de «✨ Auto-asignar» (un solo camino), ya en «Solo las marcadas».
    expect(pagina).toContain("data-auto-asignar-del-recuadro onClick={() => setDialogoAutoAsignar(true)}");
  });
  it("al quedarse sin marcadas, lo pulsado se olvida; y el selector de bloque viejo ya no está", () => {
    expect(pagina).toContain("useEffect(() => { if (poolSelectedCount === 0) setConductorPulsado(null); }, [poolSelectedCount]);");
    expect(pagina).not.toContain("Assign selected to…");
    expect(pagina).not.toContain("Auto-assign selected");
    // bulkAssign limpia la selección al terminar: eso es lo que hace irse al recuadro.
    expect(pagina.indexOf("const bulkAssign = async")).toBeGreaterThan(-1);
    // `bulkAutoAssign` se fue con D-NEXT (lo sustituye el diálogo); el cuerpo de `bulkAssign` acaba donde empieza `previewAdd`.
    expect(pagina.indexOf("const previewAdd = async")).toBeGreaterThan(pagina.indexOf("const bulkAssign = async"));
    const cuerpo = pagina.slice(pagina.indexOf("const bulkAssign = async"), pagina.indexOf("const previewAdd = async"));
    expect(cuerpo).toContain("clearSelection();");
  });
});
