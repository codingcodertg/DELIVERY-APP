import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  alternaBloqueo, avisoDeSaltadas, cargaCandados, chocaConLosCandados, choquesAlPublicar, dondeViveElCandado, estaBloqueada, faltaLaTabla, guardaBloqueos, leeBloqueos,
  leeCandadosCompartidos, LLAVE_DE_BLOQUEOS, optimizaSinLasBloqueadas, ponCandadoCompartido, pulsaCandado, quienBloqueo, rutasBloqueadasDelDia,
  type ClienteDeCandados, type EstadoDeCandados, type FilaDeCandado, type OpcionesDeCandados,
} from "./rutas-bloqueadas";

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
  // Reemplazada en parte por D-NEXT: el candado ya no se guarda siempre en el navegador; lo decide `pulsaCandado`.
  it("el candado de la tarjeta alterna el de ESE día, por `pulsaCandado` (base o navegador lo decide la librería)", () => {
    expect(pagina).toContain("onClick={(e) => { e.stopPropagation(); void alternaCandado(u.key); }}");
    const alterna = trozo("const alternaCandado = async (laneKey: string) => {", "const bloqueadaPor");
    expect(alterna).toContain("const r = await pulsaCandado(candados, date, laneKey, opcionesDeCandados());");
    expect(alterna).toContain("setCandados(r.estado);");
    expect(alterna).toContain("const donde = dondeViveElCandado(r.estado);");
    // La pantalla no toca el almacén por su cuenta.
    expect(pagina).not.toContain("guardaBloqueos(");
    expect(pagina).not.toContain("leeBloqueos(");
    expect(pagina).toContain("const bloqueada = (laneKey: string) => estaBloqueada(bloqueos, date, laneKey);");
    expect(pagina).toContain("const bloqueos = candados.bloqueos;");
  });
  it("se lee al montar y otra vez al volver a la pestaña (foco o visibilidad), de donde diga `cargaCandados`", () => {
    const efecto = trozo("const [candados, setCandados] = useState<EstadoDeCandados>(CANDADOS_SIN_LEER);", "// eslint-disable-line react-hooks/exhaustive-deps");
    expect(efecto).toContain("void cargaCandados(opcionesDeCandados()).then((e) => { if (vivo) setCandados(e); });");
    expect(efecto).toContain('window.addEventListener("focus", alVolver);');
    expect(efecto).toContain('document.addEventListener("visibilitychange", alVolver);');
    expect(efecto).toContain('const alVolver = () => { if (document.visibilityState === "visible") lee(); };');
    expect(pagina).toContain("sinBase: SIN_BASE, cliente: () => createClient() as unknown as ClienteDeCandados,");
  });
  it("el botón dice dónde vive el candado, y quién lo puso", () => {
    expect(pagina).toContain("data-candado-fuente={candados.fuente}");
    expect(pagina).toContain("${t(dondeViveElCandado(candados).en, dondeViveElCandado(candados).es)}");
    expect(pagina).toContain("const id = quienBloqueo(candados.quien, date, laneKey);");
  });
  it("se ve: 🔒 en la tarjeta, en el panel de choferes y en el recuadro «Elige conductor»", () => {
    expect(pagina).toContain("{bloqueada(u.key) ? `🔒 ${t(\"Locked\", \"Bloqueada\")}` : `🔓 ${t(\"Lock\", \"Bloquear\")}`}");
    expect(pagina).toContain("{bloqueada(u.key) && <span data-candado-en-el-panel");
    expect(pagina).toContain("{o.etiqueta}{bloqueada(o.clave) ? \" 🔒\" : \"\"}");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// El candado compartido (149, D-NEXT)
// ---------------------------------------------------------------------------------------------------------------

/** Un doble del cliente de Supabase que apunta lo que se le pide y contesta lo que se le diga. */
function clienteFalso(opts: { filas?: FilaDeCandado[]; alLeer?: { code?: string; message?: string } | null; alEscribir?: { code?: string; message?: string } | null } = {}) {
  const llamadas: string[] = [];
  const filas = [...(opts.filas ?? [])];
  const leer = (op: string) => { llamadas.push(op); return Promise.resolve(opts.alLeer ? { data: null, error: opts.alLeer } : { data: [...filas], error: null }); };
  const escribir = (op: string, efecto: () => void) => { llamadas.push(op); if (!opts.alEscribir) efecto(); return Promise.resolve({ data: null, error: opts.alEscribir ?? null }); };
  const cliente: ClienteDeCandados = {
    from: (tabla: string) => {
      llamadas.push(`from:${tabla}`);
      return {
        select: (c: string) => ({ gte: (col: string, v: string) => leer(`select:${c}|gte:${col}=${v}`), eq: (col: string, v: string) => leer(`select:${c}|eq:${col}=${v}`) }),
        insert: (f: { plan_date: string; lane: string }) => escribir(`insert:${f.plan_date}/${f.lane}`, () => { filas.push({ ...f, locked_by: "yo" }); }),
        delete: () => ({ eq: (c1: string, v1: string) => ({ eq: (c2: string, v2: string) => escribir(`delete:${c1}=${v1}&${c2}=${v2}`, () => {
          const i = filas.findIndex((f) => f.plan_date === v1 && f.lane === v2); if (i >= 0) filas.splice(i, 1);
        }) }) }),
      };
    },
  };
  return { cliente, llamadas, filas };
}
const SIN_TABLA = { code: "PGRST205", message: "Could not find the table 'public.route_locks' in the schema cache" };

describe("¿falta la tabla? (la 149 sin aplicar)", () => {
  it("PGRST205, 42P01 o el mensaje sobre route_locks: sí; cualquier otro fallo: no", () => {
    expect(faltaLaTabla(SIN_TABLA)).toBe(true);
    expect(faltaLaTabla({ code: "42P01", message: "relation does not exist" })).toBe(true);
    expect(faltaLaTabla({ code: "PGRST205", message: "" })).toBe(true);
    expect(faltaLaTabla({ message: 'relation "public.route_locks" does not exist' })).toBe(true);
    expect(faltaLaTabla({ code: "42501", message: "permission denied for table route_locks" })).toBe(false);
    expect(faltaLaTabla({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(faltaLaTabla(null)).toBe(false);
  });
});

describe("leer y escribir el candado en la base", () => {
  it("lee los de los últimos 14 días, con quién los puso", async () => {
    const { cliente, llamadas } = clienteFalso({ filas: [
      { plan_date: "2026-09-27", lane: "Diego Driver", locked_by: "u-log" },
      { plan_date: "2026-09-27", lane: "Carlos R.", locked_by: null },
      { plan_date: "2026-09-28", lane: "Diego Driver", locked_by: "u-admin" },
    ] });
    const r = await leeCandadosCompartidos(cliente, "2026-09-27");
    expect(llamadas).toEqual(["from:route_locks", "select:plan_date, lane, locked_by, locked_at|gte:plan_date=2026-09-13"]);
    expect(r).toEqual({ fuente: "base", bloqueos: { "2026-09-27": ["Diego Driver", "Carlos R."], "2026-09-28": ["Diego Driver"] },
      quien: { "2026-09-27|Diego Driver": "u-log", "2026-09-27|Carlos R.": null, "2026-09-28|Diego Driver": "u-admin" } });
    if (r.fuente === "base") expect(quienBloqueo(r.quien, "2026-09-28", "Diego Driver")).toBe("u-admin");
  });
  it("sin la tabla dice «sin_tabla»; con otro fallo, «error» — y en los dos, que se use el navegador", async () => {
    expect(await leeCandadosCompartidos(clienteFalso({ alLeer: SIN_TABLA }).cliente, "2026-09-27")).toMatchObject({ fuente: "navegador", motivo: "sin_tabla" });
    expect(await leeCandadosCompartidos(clienteFalso({ alLeer: { code: "57014", message: "timeout" } }).cliente, "2026-09-27")).toMatchObject({ fuente: "navegador", motivo: "error" });
  });
  it("bloquear inserta la fila; desbloquear la borra por día Y ruta; un 23505 (ya bloqueada por otro) cuenta como hecho", async () => {
    const a = clienteFalso();
    expect(await ponCandadoCompartido(a.cliente, "2026-09-27", "Diego Driver", true)).toEqual({ ok: true });
    expect(a.llamadas).toContain("insert:2026-09-27/Diego Driver");
    expect(await ponCandadoCompartido(a.cliente, "2026-09-27", "Diego Driver", false)).toEqual({ ok: true });
    expect(a.llamadas).toContain("delete:plan_date=2026-09-27&lane=Diego Driver");
    expect(await ponCandadoCompartido(clienteFalso({ alEscribir: { code: "23505", message: "duplicate key" } }).cliente, "2026-09-27", "X", true)).toEqual({ ok: true });
    expect(await ponCandadoCompartido(clienteFalso({ alEscribir: { code: "42501", message: "new row violates row-level security" } }).cliente, "2026-09-27", "X", true))
      .toEqual({ ok: false, faltaLaTabla: false, detalle: "new row violates row-level security" });
  });
  it("el servidor lee las de UN día; sin tabla lo dice; con otro fallo, error (no «ninguna»)", async () => {
    const a = clienteFalso({ filas: [{ plan_date: "2026-09-27", lane: "Diego Driver", locked_by: null }] });
    expect(await rutasBloqueadasDelDia(a.cliente, "2026-09-27")).toEqual({ fuente: "base", rutas: ["Diego Driver"] });
    expect(a.llamadas).toContain("select:plan_date, lane, locked_by|eq:plan_date=2026-09-27");
    expect(await rutasBloqueadasDelDia(clienteFalso({ alLeer: SIN_TABLA }).cliente, "2026-09-27")).toEqual({ fuente: "sin_tabla" });
    expect(await rutasBloqueadasDelDia(clienteFalso({ alLeer: { code: "57014", message: "timeout" } }).cliente, "2026-09-27")).toEqual({ fuente: "error", detalle: "timeout" });
  });
});

describe("la pantalla: de dónde lee, dónde escribe y qué dice (cargaCandados / pulsaCandado)", () => {
  const opciones = (c: ClienteDeCandados, nav = almacen(), sinBase = false): OpcionesDeCandados => ({ sinBase, cliente: () => c, navegador: nav, hoy: "2026-09-27" });

  it("en el demo, el navegador, sin preguntar a la base", async () => {
    const { cliente, llamadas } = clienteFalso();
    const e = await cargaCandados(opciones(cliente, almacen({ [LLAVE_DE_BLOQUEOS]: '{"2026-09-27":["Diego Driver"]}' }), true));
    expect(e).toEqual({ bloqueos: { "2026-09-27": ["Diego Driver"] }, quien: {}, fuente: "navegador", motivo: "demo" });
    expect(llamadas).toEqual([]);
  });
  it("con la tabla, la base (y lo del navegador NO se mezcla)", async () => {
    const { cliente } = clienteFalso({ filas: [{ plan_date: "2026-09-27", lane: "Carlos R.", locked_by: "u-log" }] });
    const e = await cargaCandados(opciones(cliente, almacen({ [LLAVE_DE_BLOQUEOS]: '{"2026-09-27":["Diego Driver"]}' })));
    expect(e).toEqual({ bloqueos: { "2026-09-27": ["Carlos R."] }, quien: { "2026-09-27|Carlos R.": "u-log" }, fuente: "base", motivo: null });
  });
  it("sin la tabla, degrada al navegador y dice por qué", async () => {
    const e = await cargaCandados(opciones(clienteFalso({ alLeer: SIN_TABLA }).cliente, almacen({ [LLAVE_DE_BLOQUEOS]: '{"2026-09-27":["Diego Driver"]}' })));
    expect(e).toEqual({ bloqueos: { "2026-09-27": ["Diego Driver"] }, quien: {}, fuente: "navegador", motivo: "sin_tabla" });
    expect(dondeViveElCandado(e).es).toContain("Solo en este navegador: la base aún no tiene la tabla de candados (migración 149)");
  });
  it("pulsar con la base: escribe la fila, NO toca el navegador, y vuelve a leer (ve también lo de otra persona)", async () => {
    const f = clienteFalso({ filas: [{ plan_date: "2026-09-27", lane: "Carlos R.", locked_by: "otra" }] });
    const nav = almacen();
    const o = opciones(f.cliente, nav);
    const leido = await cargaCandados(o);
    // Otra persona bloquea Miguel A. después de que esta pantalla leyera: sin volver a leer, no se vería.
    f.filas.push({ plan_date: "2026-09-27", lane: "Miguel A.", locked_by: "otra-mas" });
    const r = await pulsaCandado(leido, "2026-09-27", "Diego Driver", o);
    expect(r.error).toBeNull();
    expect(r.bloqueada).toBe(true);
    expect(f.llamadas).toContain("insert:2026-09-27/Diego Driver");
    expect(r.estado.bloqueos).toEqual({ "2026-09-27": ["Carlos R.", "Miguel A.", "Diego Driver"] });
    expect(r.estado.quien["2026-09-27|Carlos R."]).toBe("otra");
    expect(nav.m.has(LLAVE_DE_BLOQUEOS)).toBe(false);
    expect(dondeViveElCandado(r.estado).es).toBe("Compartido: lo ve todo logística, y «Planificar el día» lo respeta.");
    // Y desbloquear la borra.
    const r2 = await pulsaCandado(r.estado, "2026-09-27", "Diego Driver", o);
    expect(r2.bloqueada).toBe(false);
    expect(r2.estado.bloqueos).toEqual({ "2026-09-27": ["Carlos R.", "Miguel A."] });
  });
  it("pulsar con la base y que falle (p. ej. RLS): NO cambia nada y devuelve el error", async () => {
    const f = clienteFalso({ alEscribir: { code: "42501", message: "row-level security" } });
    const antes: EstadoDeCandados = { bloqueos: {}, quien: {}, fuente: "base", motivo: null };
    const r = await pulsaCandado(antes, "2026-09-27", "Diego Driver", opciones(f.cliente));
    expect(r).toEqual({ estado: antes, bloqueada: false, error: "row-level security" });
  });
  it("pulsar con la base cuando la tabla desapareció (149 revertida): pasa al navegador y lo guarda ahí", async () => {
    const nav = almacen();
    const r = await pulsaCandado({ bloqueos: {}, quien: {}, fuente: "base", motivo: null }, "2026-09-27", "Diego Driver", opciones(clienteFalso({ alEscribir: SIN_TABLA }).cliente, nav));
    expect(r.error).toBeNull();
    expect(r.estado).toMatchObject({ fuente: "navegador", motivo: "sin_tabla", bloqueos: { "2026-09-27": ["Diego Driver"] } });
    expect(nav.m.get(LLAVE_DE_BLOQUEOS)).toBe('{"2026-09-27":["Diego Driver"]}');
  });
  it("pulsar sin base: como D-411, en el navegador, y sin llamar a la base", async () => {
    const f = clienteFalso();
    const nav = almacen();
    const r = await pulsaCandado({ bloqueos: {}, quien: {}, fuente: "navegador", motivo: "sin_tabla" }, "2026-09-27", "Diego Driver", opciones(f.cliente, nav));
    expect(r.bloqueada).toBe(true);
    expect(nav.m.get(LLAVE_DE_BLOQUEOS)).toBe('{"2026-09-27":["Diego Driver"]}');
    expect(f.llamadas).toEqual([]);
  });
});

describe("publicar con un candado puesto después de planificar (chocaConLosCandados)", () => {
  it("choca si asigna A una ruta bloqueada, o si mueve/reordena una orden que HOY está en una; si no, nada", () => {
    const hoy = new Map<string, string | null>([["o1", "Diego Driver"], ["o2", null], ["o3", "Carlos R."]]);
    const escrituras = [{ id: "o1", assigned_driver: "Carlos R." }, { id: "o2", assigned_driver: "diego driver " }, { id: "o3", assigned_driver: "Carlos R." }];
    expect(chocaConLosCandados(escrituras, hoy, ["Diego Driver"])).toEqual([{ id: "o1", ruta: "Diego Driver" }, { id: "o2", ruta: "diego driver " }]);
    expect(chocaConLosCandados(escrituras, hoy, [])).toEqual([]);
    expect(chocaConLosCandados(escrituras, hoy, ["Otra Ruta"])).toEqual([]);
  });
});

describe("choquesAlPublicar: los candados del día contra lo asignado HOY", () => {
  const ordenes = (filas: { id: string; assigned_driver: string | null }[], llamadas: string[]) => ({
    from: (t: string) => ({ select: (c: string) => ({ in: (col: string, v: string[]) => { llamadas.push(`${t}:${c}|${col}=${v.join(",")}`); return Promise.resolve({ data: filas, error: null }); } }) }),
  });
  const escrituras = [{ id: "o1", assigned_driver: "Carlos R." }, { id: "o2", assigned_driver: "Carlos R." }];
  it("con un candado, lee a quién están asignadas hoy las órdenes del plan y devuelve las que chocan", async () => {
    const llamadas: string[] = [];
    const r = await choquesAlPublicar(clienteFalso({ filas: [{ plan_date: "2026-09-27", lane: "Diego Driver", locked_by: null }] }).cliente,
      ordenes([{ id: "o1", assigned_driver: "Diego Driver" }, { id: "o2", assigned_driver: null }], llamadas), "2026-09-27", escrituras);
    expect(r).toEqual({ fuente: "base", choques: [{ id: "o1", ruta: "Diego Driver" }] });
    expect(llamadas).toEqual(["deliveries:id, assigned_driver|id=o1,o2"]);
  });
  it("sin candados ese día, ni pregunta por las órdenes; sin tabla lo dice; con fallo, error", async () => {
    const llamadas: string[] = [];
    expect(await choquesAlPublicar(clienteFalso().cliente, ordenes([], llamadas), "2026-09-27", escrituras)).toEqual({ fuente: "base", choques: [] });
    expect(llamadas).toEqual([]);
    expect(await choquesAlPublicar(clienteFalso({ alLeer: SIN_TABLA }).cliente, ordenes([], llamadas), "2026-09-27", escrituras)).toEqual({ fuente: "sin_tabla" });
    expect(await choquesAlPublicar(clienteFalso({ alLeer: { code: "57014", message: "timeout" } }).cliente, ordenes([], llamadas), "2026-09-27", escrituras)).toEqual({ fuente: "error", detalle: "timeout" });
  });
});

describe("«Planificar el día» y «Publicar ruta» leen el candado compartido", () => {
  const leer = (f: string) => readFileSync(join(process.cwd(), f), "utf8").split("\r\n").join("\n").replace(/\s+/g, " ");
  it("planificar: lee las del día, se para si la lectura falla, y se las pasa al motor", () => {
    const r = leer("src/app/api/route-plan/route.ts");
    expect(r).toContain("const candados = await rutasBloqueadasDelDia(supabase as unknown as ClienteDeCandados, fecha);");
    expect(r).toContain('if (candados.fuente === "error") return NextResponse.json({ error: "Could not read the locked routes."');
    expect(r).toContain('bloqueadas: candados.fuente === "base" ? candados.rutas : [],');
    expect(r).toContain("candados: candados.fuente,");
  });
  it("publicar: rechaza el plan que choca con un candado, y no avisa «sin paradas» al chofer bloqueado", () => {
    const r = leer("src/app/api/route-plan/publish/route.ts");
    expect(r).toContain("const candados = await choquesAlPublicar(supabase as unknown as ClienteDeCandados, supabase as unknown as ClienteDeOrdenes, String(plan.plan_date), (plan.writes ?? [])");
    expect(r).toContain('if (candados.fuente === "error") return NextResponse.json({ error: "Could not read the locked routes."');
    expect(r).toContain('if (candados.fuente === "base" && candados.choques.length) return NextResponse.json({ error: "ROUTE_LOCKED", detail: candados.choques }, { status: 409 });');
    expect(r).toContain("choferesConRutaBloqueada(plan.choferesFuera)");
    expect(r).toContain('.select("id, plan_date, status, source, writes, choferesFuera:result->choferesFuera")');
  });
  it("el panel del plan dice cuando el plan no conoce los candados, y por qué no se publicó", () => {
    const r = leer("src/components/PlanDelDia.tsx");
    expect(r).toContain('{borrador?.candados === "sin_tabla" && (');
    expect(r).toContain('b.error === "ROUTE_LOCKED" && Array.isArray(b.detail)');
  });
});

describe("la migración 149", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/149_route_locks.sql"), "utf8").split("\r\n").join("\n");
  const codigo = (t: string) => t.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
  it("tabla con clave (día, ruta), sellada por la base; tres políticas por comando y ninguna ALL ni UPDATE", () => {
    const c = codigo(sql);
    expect(c).toContain("constraint route_locks_pkey primary key (plan_date, lane)");
    expect(c).toContain("if auth.uid() is not null then NEW.locked_by := auth.uid(); end if;");
    expect(c).toContain("revoke all on public.route_locks from anon, authenticated;");
    expect(c).toContain("grant select, insert, delete on public.route_locks to authenticated;");
    expect(c.match(/create policy "route_locks \w+" on public\.route_locks for \w+/g)).toEqual([
      'create policy "route_locks select" on public.route_locks for select',
      'create policy "route_locks insert" on public.route_locks for insert',
      'create policy "route_locks delete" on public.route_locks for delete',
    ]);
    expect(c).toContain("in ('admin', 'logistics', 'manager', 'accounting', 'warehouse'));");
    expect(c.match(/in \('admin', 'logistics'\)\);/g)).toHaveLength(2);
    expect(c).not.toMatch(/create policy[^;]*\sfor (all|update)\s/i);
  });
  it("sin begin/commit propios, con reversión y con su fila del registro al día", () => {
    expect(codigo(sql)).not.toMatch(/(^|;)\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toContain("D-NEXT");
    expect(sql).toContain("--   drop table if exists public.route_locks;");
    const [cuerpo, registro] = sql.split("-- @ledger-below");
    const sha = createHash("sha256").update(cuerpo, "utf8").digest("hex");
    expect(registro.trim()).toBe(`insert into public.schema_migrations (name, checksum) values ('149_route_locks.sql', '${sha}') on conflict (name) do nothing;`);
  });
});
