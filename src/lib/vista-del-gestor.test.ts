import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PANEL_SIN_ASIGNAR, TODOS_LOS_CHOFERES, claveDelFiltroDeChofer, estaPlegada, filtroVigente, guardaFiltroDeChofer, leeFiltroDeChofer, nacePlegada, pasaElFiltroDeChofer,
} from "./vista-del-gestor";

/** El filtro de chofer y el «todo nace plegado» del Gestor de Rutas (D-393). */

const almacen = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("el filtro de chofer se recuerda por persona", () => {
  it("sin nada guardado, «Todos»", () => {
    const a = almacen();
    expect(leeFiltroDeChofer(a.getItem, "u1")).toBe(TODOS_LOS_CHOFERES);
  });
  it("lo que eligió una persona vuelve al recargar, y NO es lo de otra persona en la misma computadora", () => {
    const a = almacen();
    guardaFiltroDeChofer(() => a, "u1", "Máximo");
    expect(leeFiltroDeChofer(a.getItem, "u1")).toBe("Máximo");
    expect(leeFiltroDeChofer(a.getItem, "u2")).toBe(TODOS_LOS_CHOFERES);
    expect(claveDelFiltroDeChofer("u1")).not.toBe(claveDelFiltroDeChofer("u2"));
  });
  it("volver a «Todos» BORRA la clave, no guarda un vacío", () => {
    const a = almacen();
    guardaFiltroDeChofer(() => a, "u1", "Máximo");
    guardaFiltroDeChofer(() => a, "u1", TODOS_LOS_CHOFERES);
    expect(a.m.has(claveDelFiltroDeChofer("u1"))).toBe(false);
    expect(leeFiltroDeChofer(a.getItem, "u1")).toBe(TODOS_LOS_CHOFERES);
  });
  it("un navegador que niega el almacenamiento no rompe nada: se lee «Todos» y guardar no lanza", () => {
    const lanza = () => { throw new Error("SecurityError"); };
    expect(leeFiltroDeChofer(lanza, "u1")).toBe(TODOS_LOS_CHOFERES);
    expect(() => guardaFiltroDeChofer(lanza, "u1", "Máximo")).not.toThrow();
  });
  it("lo guardado manda solo si ese chofer sigue en la pantalla; si no, «Todos» (y lo guardado no se toca)", () => {
    expect(filtroVigente("Máximo", ["Ernesto", "Máximo"])).toBe("Máximo");
    expect(filtroVigente("Máximo", ["Ernesto", "Julio"])).toBe(TODOS_LOS_CHOFERES);
    // Los usuarios aún no cargan: la pantalla no se queda vacía.
    expect(filtroVigente("Máximo", [])).toBe(TODOS_LOS_CHOFERES);
  });
  it("con «Todos» pasa toda ruta; con un chofer, solo la suya", () => {
    expect(["Ernesto", "Máximo", null].every((r) => pasaElFiltroDeChofer(TODOS_LOS_CHOFERES, r))).toBe(true);
    expect(pasaElFiltroDeChofer("Máximo", "Máximo")).toBe(true);
    expect(pasaElFiltroDeChofer("Máximo", "Ernesto")).toBe(false);
    expect(pasaElFiltroDeChofer("Máximo", null)).toBe(false);
  });
});

describe("las tarjetas de los choferes nacen plegadas", () => {
  it("toda tarjeta de chofer o ruta nace plegada; «Sin asignar», abierta", () => {
    expect(nacePlegada("Máximo")).toBe(true);
    expect(nacePlegada("Ruta 1")).toBe(true);
    expect(nacePlegada(PANEL_SIN_ASIGNAR)).toBe(false);
    expect(estaPlegada("Máximo", new Set())).toBe(true);
    expect(estaPlegada(PANEL_SIN_ASIGNAR, new Set())).toBe(false);
  });
  it("pulsarla la abre, y pulsar «Sin asignar» la pliega; las demás no se mueven", () => {
    const pulsadas = new Set(["Máximo", PANEL_SIN_ASIGNAR]);
    expect(estaPlegada("Máximo", pulsadas)).toBe(false);
    expect(estaPlegada("Ernesto", pulsadas)).toBe(true);
    expect(estaPlegada(PANEL_SIN_ASIGNAR, pulsadas)).toBe(true);
  });
});

describe("la pantalla del Gestor usa el filtro y el plegado (D-393)", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("el plegado sale de `estaPlegada` y empieza sin nada pulsado; no se guarda en ningún sitio", () => {
    expect(pagina).toContain("const [alternadas, setAlternadas] = useState<Set<string>>(new Set());");
    expect(pagina).toContain("const isCollapsed = (id: string) => estaPlegada(id, alternadas);");
    expect(pagina).not.toContain("const [collapsed, setCollapsed]");
    expect(pagina).toContain("const isC = isCollapsed(u.key);");
  });
  it("el filtro se lee de lo guardado por la persona, y elegir lo guarda", () => {
    expect(pagina).toContain("setFiltroGuardado(leeFiltroDeChofer((k) => window.localStorage.getItem(k), me.id));");
    expect(pagina).toContain("guardaFiltroDeChofer(() => window.localStorage, me.id, chofer);");
    expect(pagina).toContain("value={filtroChofer} onChange={(e) => eligeFiltroDeChofer(e.target.value)}");
    expect(pagina).toContain("const filtroChofer = filtroVigente(filtroGuardado, lanes.map((l) => l.key));");
  });
  it("con un chofer elegido: su fila en el panel, su tarjeta en «Rutas», y en el mapa solo lo suyo", () => {
    expect(pagina).toContain("const lanesDelFiltro = lanes.filter((l) => pasaFiltro(l.key));");
    expect(pagina).toContain("{lanesDelFiltro.map((u) => {");
    expect(pagina).toContain("const shownDrivers = lanesDelFiltro.filter(");
    // El mapa: la base y las P de cada ruta, sus paradas, lo sin chofer, las líneas y el camión en vivo.
    expect(pagina).toContain("if (!pasaFiltro(u.key)) continue; const addr = (pickupAddressFor(u.key) ?? \"\").trim();");
    expect(pagina).toContain("if (!list.some((d) => d.route_seq != null)) continue; if (!pasaFiltro(laneKey)) continue;");
    expect(pagina).toContain("if (!sel && !pasaFiltro(laneKey)) continue;");
    expect(pagina).toContain("if (!sel && filtroChofer !== TODOS_LOS_CHOFERES) continue;");
    expect(pagina).toContain("const entries = Object.entries(routeLines).filter(([driver]) => pasaFiltro(driver));");
    expect(pagina).toContain("if (geom.length < 2 || !pasaFiltro(driver)) continue;");
    expect(pagina).toContain("liveDrivers={liveDrivers.filter((c) => pasaFiltro(c.driver))}");
  });
});
