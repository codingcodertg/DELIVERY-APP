import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { alternaBloqueo, avisoDeSaltadas, estaBloqueada, guardaBloqueos, leeBloqueos, LLAVE_DE_BLOQUEOS, optimizaSinLasBloqueadas } from "./rutas-bloqueadas";

/** 🔒 Rutas bloqueadas del Gestor de Rutas (D-411). */

const almacen = (inicial: Record<string, string> = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};

describe("el candado, por ruta y por día", () => {
  it("bloquear y desbloquear una ruta en un día", () => {
    const b1 = alternaBloqueo({}, "2026-09-26", "Diego Driver", "2026-09-26");
    expect(estaBloqueada(b1, "2026-09-26", "Diego Driver")).toBe(true);
    const b2 = alternaBloqueo(b1, "2026-09-26", "Diego Driver", "2026-09-26");
    expect(estaBloqueada(b2, "2026-09-26", "Diego Driver")).toBe(false);
    expect(b2).toEqual({});
  });
  it("es de ESE día y de ESA ruta: otro día u otro chofer no quedan bloqueados", () => {
    const b = alternaBloqueo({}, "2026-09-26", "Diego Driver", "2026-09-26");
    expect(estaBloqueada(b, "2026-09-27", "Diego Driver")).toBe(false);
    expect(estaBloqueada(b, "2026-09-26", "Carlos R.")).toBe(false);
  });
  it("bloquear otra ruta no suelta la primera", () => {
    const b = alternaBloqueo(alternaBloqueo({}, "2026-09-26", "Diego Driver", "2026-09-26"), "2026-09-26", "Carlos R.", "2026-09-26");
    expect(b["2026-09-26"]).toEqual(["Diego Driver", "Carlos R."]);
  });
  it("lo de hace más de 14 días se olvida; lo de dentro de los 14, no", () => {
    const viejo = { "2026-09-01": ["A"], "2026-09-12": ["B"] };
    const b = alternaBloqueo(viejo, "2026-09-26", "C", "2026-09-26");
    expect(Object.keys(b).sort()).toEqual(["2026-09-12", "2026-09-26"]);
  });
  it("se guarda y se vuelve a leer igual; lo que no es un mapa de listas de texto se lee vacío", () => {
    const a = almacen();
    guardaBloqueos(a, { "2026-09-26": ["Diego Driver"] });
    expect(a.m.get(LLAVE_DE_BLOQUEOS)).toBe('{"2026-09-26":["Diego Driver"]}');
    expect(leeBloqueos(a)).toEqual({ "2026-09-26": ["Diego Driver"] });
    expect(leeBloqueos(almacen({ [LLAVE_DE_BLOQUEOS]: "no es json" }))).toEqual({});
    expect(leeBloqueos(almacen({ [LLAVE_DE_BLOQUEOS]: "[1,2]" }))).toEqual({});
    expect(leeBloqueos(almacen({ [LLAVE_DE_BLOQUEOS]: '{"2026-09-26":["A",3]}' }))).toEqual({ "2026-09-26": ["A"] });
    expect(leeBloqueos(null)).toEqual({});
  });
});

describe("optimizar sin las bloqueadas", () => {
  const rutas = [{ clave: "Diego Driver" }, { clave: "Carlos R." }, { clave: "Miguel A." }];
  it("la bloqueada NO se pide (cero llamadas al optimizador); las demás, sí, una vez cada una", async () => {
    const optimizaUna = vi.fn(async () => {});
    const r = await optimizaSinLasBloqueadas({ rutas, bloqueada: (k) => k === "Carlos R.", optimizaUna });
    expect(optimizaUna).toHaveBeenCalledTimes(2);
    expect(optimizaUna.mock.calls.map((c) => (c as unknown as [{ clave: string }])[0].clave)).toEqual(["Diego Driver", "Miguel A."]);
    expect(r).toEqual({ bien: ["Diego Driver", "Miguel A."], saltadas: ["Carlos R."], fallidas: [] });
  });
  it("una que falla no cuenta como bien, se avisa, y el bucle sigue", async () => {
    const alFallar = vi.fn();
    const r = await optimizaSinLasBloqueadas({
      rutas, bloqueada: () => false, alFallar,
      optimizaUna: async (x) => { if (x.clave === "Diego Driver") throw new Error("401"); },
    });
    expect(r).toEqual({ bien: ["Carlos R.", "Miguel A."], saltadas: [], fallidas: ["Diego Driver"] });
    expect(alFallar).toHaveBeenCalledTimes(1);
  });
  it("la pausa va entre las que se piden, no por las saltadas", async () => {
    const pausa = vi.fn(async () => {});
    await optimizaSinLasBloqueadas({ rutas, bloqueada: (k) => k !== "Diego Driver", optimizaUna: async () => {}, pausa });
    expect(pausa).toHaveBeenCalledTimes(1);
  });
  it("el aviso dice cuántas se saltó y cuáles; sin saltadas, nada", () => {
    expect(avisoDeSaltadas(["Carlos R."])!.es).toBe("Se saltó 1 ruta(s) bloqueada(s) 🔒: Carlos R..");
    expect(avisoDeSaltadas([])).toBeNull();
  });
});

describe("la pantalla del Gestor respeta el candado", () => {
  const pagina = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  const trozo = (desde: string, hasta: string) => {
    const i = pagina.indexOf(desde);
    expect(i).toBeGreaterThan(-1);
    return pagina.slice(i, pagina.indexOf(hasta, i + desde.length));
  };

  it("«Optimizar todas las rutas» y el diálogo optimizan con `optimizaSinLasBloqueadas`, y el aviso dice cuántas se saltó", () => {
    const optimizaEstas = trozo("const optimizaEstas = async", "const repartirConElDialogo");
    expect(optimizaEstas).toContain("await optimizaSinLasBloqueadas({ rutas, bloqueada,");
    expect(optimizaEstas).toContain("await applyPlan(r.clave, await computeRoute(r.clave, r.paradas));");
    expect(optimizaEstas).toContain("const aviso = avisoDeSaltadas(saltadas.map(laneLabel));");
    expect(optimizaEstas).toContain("if (aviso) notify(");
    // Y ya no hay otro bucle que llame al optimizador por su cuenta.
    expect(optimizaEstas.match(/computeRoute\(/g)).toHaveLength(1);
  });
  it("«Auto-asignar» no le mete órdenes: el diálogo no lo ofrece, y el reparto lo quita aunque llegue marcado", () => {
    expect(pagina).toContain("rutas: drivers.filter((u) => !bloqueada(u.full_name)).map((u) => ({ clave: u.full_name, etiqueta: u.full_name, esRuta: false })),");
    expect(trozo("const repartirConElDialogo = async", "const toggleOrder")).toContain("choferes: e.choferes.filter((c) => !bloqueada(c)),");
  });
  it("«Optimizar ruta» de la tarjeta: apagado con candado, y la función tampoco lo hace", () => {
    expect(pagina).toContain("data-optimizar-ruta disabled={stops.length < 2 || busyDriver === u.key || bloqueada(u.key)}");
    const optimize = trozo("const optimize = async (driver: string) => {", "setBusyDriver(driver);");
    expect(optimize).toContain("if (bloqueada(driver)) {");
  });
  it("elegir un chofer no dibuja (optimiza) su ruta si está bloqueada", () => {
    expect(pagina).toContain("if ((byDriver.get(name)?.length ?? 0) >= 1 && !routeInfo[name] && !bloqueada(name)) { optimize(name); return; }");
  });
  it("«Simular» (que reoptimiza) y «Reagrupar por zona» no empiezan con candado", () => {
    expect(trozo("const previewAdd = async", "setPreviewBusy(d.id);")).toContain("if (bloqueada(driver)) {");
    expect(trozo("const regroupByArea = async", "setBusyDriver(laneKey);")).toContain("if (!stops.length || bloqueada(laneKey)) return;");
    // Y su botón se ve apagado, no solo no hace nada.
    expect(pagina).toContain("<button className=\"btn btn-ghost btn-sm\" disabled={busyDriver === u.key || bloqueada(u.key)} title={t(\"Drop your truckloads");
  });
  it("el candado de la tarjeta alterna el de ESE día y lo guarda en este navegador", () => {
    expect(pagina).toContain("onClick={(e) => { e.stopPropagation(); alternaCandado(u.key); }}");
    const alterna = trozo("const alternaCandado = (laneKey: string) => {", "};");
    expect(alterna).toContain("alternaBloqueo(bloqueos, date, laneKey, todayISO())");
    expect(alterna).toContain("guardaBloqueos(window.localStorage, nuevos);");
    expect(pagina).toContain("const bloqueada = (laneKey: string) => estaBloqueada(bloqueos, date, laneKey);");
    expect(pagina).toContain("useEffect(() => { setBloqueos(leeBloqueos(window.localStorage)); }, []);");
  });
  it("se ve: 🔒 en la tarjeta, en el panel de choferes y en el recuadro «Elige conductor»", () => {
    expect(pagina).toContain("{bloqueada(u.key) ? `🔒 ${t(\"Locked\", \"Bloqueada\")}` : `🔓 ${t(\"Lock\", \"Bloquear\")}`}");
    expect(pagina).toContain("{bloqueada(u.key) && <span data-candado-en-el-panel");
    expect(pagina).toContain("{o.etiqueta}{bloqueada(o.clave) ? \" 🔒\" : \"\"}");
  });
});
