import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { A_TIEMPO_MIN, TARDE_MIN, cambiosDeEtas, claveDeEta, claveDelPlan, desvio, filasNuevasDeEtas, hechasFueraDeOrden, mapaDeEtas, mapaDeEtasGuardadas, textoDelDesvio } from "./eta-del-plan";
import { conRealEnSuSitio, preferenciasDelGestorAlLeer } from "./routes-columns";
import { claveDeRecogida } from "./usa-medida-de-rutas";

/* D-671 (194). Roberto, 2026-10-24, en la tabla de paradas del Gestor: «Need a column of "Actual" to know when they
 * delivered vs when was their ETA». Ids inventados. */

describe("lo que se apunta de una medida", () => {
  // Lo que entrega `mideLaLista`: por ruta, la llegada de cada parada; la recogida va con `claveDeRecogida`.
  const medidas = { Ana: { [claveDeRecogida(["o1", "o2"])]: "08:40", o1: "09:15", o2: "09:50" }, Beto: { o3: "10:05", o4: "calculando" } };
  it("una fila por orden y parada; la recogida de varias órdenes apunta su hora a cada una; una hora rara no", () => {
    expect(filasNuevasDeEtas(medidas, "2026-10-24", new Map())).toEqual([
      { delivery_id: "o1", plan_date: "2026-10-24", kind: "P", eta: "08:40" },
      { delivery_id: "o2", plan_date: "2026-10-24", kind: "P", eta: "08:40" },
      { delivery_id: "o1", plan_date: "2026-10-24", kind: "D", eta: "09:15" },
      { delivery_id: "o2", plan_date: "2026-10-24", kind: "D", eta: "09:50" },
      { delivery_id: "o3", plan_date: "2026-10-24", kind: "D", eta: "10:05" },
    ]);
  });
  it("lo ya apuntado no se vuelve a mandar: la PRIMERA llegada del día gana", () => {
    const ya = mapaDeEtas([{ delivery_id: "o1", kind: "D", eta: "09:00" }, { delivery_id: "o2", kind: "P", eta: "08:30" }]);
    const nuevas = filasNuevasDeEtas(medidas, "2026-10-24", ya);
    expect(nuevas.map((f) => claveDeEta(f.delivery_id, f.kind))).toEqual(["P:o1", "D:o2", "D:o3"]);
    expect(filasNuevasDeEtas({}, "2026-10-24", ya)).toEqual([]);
  });
  it("la misma parada en dos rutas (un traspaso a mitad de medida) sale una vez, la primera", () => {
    expect(filasNuevasDeEtas({ Ana: { o9: "11:00" }, Beto: { o9: "12:00" } }, "2026-10-24", new Map())).toEqual([{ delivery_id: "o9", plan_date: "2026-10-24", kind: "D", eta: "11:00" }]);
  });
});

/* D-NEXT (2026-11-06, 260). Roberto: «Something is off with the times». La ruta de Ernesto del 5 de noviembre tenía en
 * la columna de la prevista horas de dos planes (08:28 y 11:14) puestas en el orden de un tercero: parada 1 «08:50» con
 * la base saliendo 08:53, paradas 3-4 «13:33», la 5 «12:39», la 6 «08:50». La prevista pasa a ser la del plan vigente. */
describe("la clave del plan de una ruta", () => {
  const lista = [{ tipo: "P" as const, ordenes: ["a", "b"] }, { tipo: "D" as const, orden: "a" }, { tipo: "D" as const, orden: "b" }];
  const clave = claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>RDZ McAllen", lista);
  it("16 hex, y la misma para la misma ruta (dos pantallas dan la misma)", () => {
    expect(clave).toMatch(/^[0-9a-f]{16}$/);
    expect(claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>RDZ McAllen", lista.map((p) => ({ ...p })))).toBe(clave);
  });
  it("no depende de cómo se agrupan las recogidas en paradas: son las mismas órdenes en el mismo orden", () => {
    expect(claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>RDZ McAllen", [{ tipo: "P", ordenes: ["a"] }, { tipo: "P", ordenes: ["b"] }, lista[1], lista[2]])).toBe(clave);
  });
  it("cambia si se mueve, se añade o se quita una parada, si cambia la salida o el fin, el chofer o el día", () => {
    const otras = [
      claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>RDZ McAllen", [lista[0], lista[2], lista[1]]),
      claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>RDZ McAllen", [...lista, { tipo: "D", orden: "c" }]),
      claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>RDZ McAllen", lista.slice(0, 2)),
      claveDelPlan("2026-11-05", "Ernesto", "RDZ Pharr>RDZ McAllen", lista),
      claveDelPlan("2026-11-05", "Ernesto", "RDZ McAllen>·", lista),
      claveDelPlan("2026-11-05", "Julio", "RDZ McAllen>RDZ McAllen", lista),
      claveDelPlan("2026-11-06", "Ernesto", "RDZ McAllen>RDZ McAllen", lista),
    ];
    for (const o of otras) expect(o).not.toBe(clave);
    expect(new Set(otras).size).toBe(otras.length);
  });
});

describe("qué se escribe de una medida: lo nuevo se apunta, lo de otro plan se rehace, lo del mismo plan no se toca", () => {
  const AHORA = "2026-11-05T17:14:00.000Z";
  const medidas = { Ernesto: { etas: { [claveDeRecogida(["o1", "o2"])]: "08:50", o1: "09:32", o2: "10:56" }, plan: "aaaaaaaaaaaaaaaa" } };
  it("nada apuntado: todo es nuevo, con su plan y su primera del día", () => {
    const { nuevas, rehechas } = cambiosDeEtas(medidas, "2026-11-05", new Map(), AHORA);
    expect(rehechas).toEqual([]);
    expect(nuevas).toEqual([
      { delivery_id: "o1", plan_date: "2026-11-05", kind: "P", eta: "08:50", plan_key: "aaaaaaaaaaaaaaaa", first_eta: "08:50" },
      { delivery_id: "o2", plan_date: "2026-11-05", kind: "P", eta: "08:50", plan_key: "aaaaaaaaaaaaaaaa", first_eta: "08:50" },
      { delivery_id: "o1", plan_date: "2026-11-05", kind: "D", eta: "09:32", plan_key: "aaaaaaaaaaaaaaaa", first_eta: "09:32" },
      { delivery_id: "o2", plan_date: "2026-11-05", kind: "D", eta: "10:56", plan_key: "aaaaaaaaaaaaaaaa", first_eta: "10:56" },
    ]);
  });
  it("el MISMO plan: aunque la medida de ahora diga otra hora (el día avanza, el chofer se retrasa), la prevista no se toca", () => {
    const ya = mapaDeEtasGuardadas(cambiosDeEtas(medidas, "2026-11-05", new Map(), AHORA).nuevas);
    const mastarde = { Ernesto: { etas: { o2: "13:00" }, plan: "aaaaaaaaaaaaaaaa" } };
    expect(cambiosDeEtas(mastarde, "2026-11-05", ya, AHORA)).toEqual({ nuevas: [], rehechas: [] });
  });
  it("OTRO plan (la ruta se reordenó o se le añadió una orden): lo pendiente se rehace entero; la primera del día no viaja", () => {
    const ya = mapaDeEtasGuardadas(cambiosDeEtas(medidas, "2026-11-05", new Map(), AHORA).nuevas);
    // o1 ya se entregó: la medida solo trae lo pendiente (o2) y la orden nueva (o3).
    const nuevoPlan = { Ernesto: { etas: { o2: "12:10", [claveDeRecogida(["o3"])]: "11:40", o3: "13:05" }, plan: "bbbbbbbbbbbbbbbb" } };
    const { nuevas, rehechas } = cambiosDeEtas(nuevoPlan, "2026-11-05", ya, AHORA);
    expect(rehechas).toEqual([{ delivery_id: "o2", plan_date: "2026-11-05", kind: "D", eta: "12:10", plan_key: "bbbbbbbbbbbbbbbb", plan_at: AHORA }]);
    expect(rehechas[0]).not.toHaveProperty("first_eta");
    expect(nuevas.map((f) => `${f.kind}:${f.delivery_id}=${f.eta}`)).toEqual(["P:o3=11:40", "D:o3=13:05"]);
    // Lo ya hecho (o1) conserva la prevista del plan con el que se hizo: nadie la manda.
    expect([...nuevas, ...rehechas].some((f) => f.delivery_id === "o1")).toBe(false);
  });
  it("una fila de antes de la 260 (sin plan) se rehace una vez y queda con su plan; una hora rara no se apunta", () => {
    const vieja = mapaDeEtasGuardadas([{ delivery_id: "o2", kind: "D", eta: "10:56" }]);
    expect(vieja.get("D:o2")).toEqual({ eta: "10:56", plan_key: null, first_eta: null });
    const r = cambiosDeEtas({ Ernesto: { etas: { o2: "10:56", o9: "calculando" }, plan: "aaaaaaaaaaaaaaaa" } }, "2026-11-05", vieja, AHORA);
    expect(r).toEqual({ nuevas: [], rehechas: [{ delivery_id: "o2", plan_date: "2026-11-05", kind: "D", eta: "10:56", plan_key: "aaaaaaaaaaaaaaaa", plan_at: AHORA }] });
  });
});

describe("lo hecho fuera del orden de la lista no lleva «±min»", () => {
  const fila = (clave: string, real: number | null, hecha = true) => ({ clave, hecha, real });
  it("la captura de Roberto: lo del final de la lista hecho a las 08:14 y 08:55 con ocho paradas pendientes delante", () => {
    const filas = [fila("", null, false), fila("", null, false), fila("P:fw170", 494), fila("D:fw170", 494), fila("", null, false), fila("P:fw176", 535), fila("D:fw176", 535)];
    expect([...hechasFueraDeOrden(filas)]).toEqual(["P:fw170", "D:fw170", "P:fw176", "D:fw176"]);
  });
  it("hecho en el orden de la lista: ninguna; dos toques en el mismo minuto no cuentan como desorden", () => {
    expect(hechasFueraDeOrden([fila("P:a", 550), fila("D:a", 606), fila("P:b", 738), fila("D:b", 737), fila("", null, false)]).size).toBe(0);
  });
  it("una hecha antes que otra que va delante en la lista: la de detrás es la que está fuera de orden", () => {
    expect([...hechasFueraDeOrden([fila("D:a", 600), fila("D:b", 540)])]).toEqual(["D:b"]);
  });
  it("una hecha sin hora real ni se marca ni cuenta", () => {
    expect(hechasFueraDeOrden([fila("D:a", null), fila("D:b", 540)]).size).toBe(0);
  });
});

describe("el desvío entre la prevista y la real", () => {
  it("minutos, con signo: más tarde es positivo; sin una de las dos, nada", () => {
    expect(desvio("09:00", "09:08")).toBe(8);
    expect(desvio("09:00", "08:52")).toBe(-8);
    expect(desvio("23:50", "23:55")).toBe(5);
    expect(desvio(null, "09:08")).toBeNull();
    expect(desvio("09:00", undefined)).toBeNull();
    expect(desvio("9:00", "09:08")).toBeNull();
  });
  it("verde hasta 10 min tarde (y si llegó antes), ámbar hasta 30, rojo después; «a tiempo» si es exacto", () => {
    expect([A_TIEMPO_MIN, TARDE_MIN]).toEqual([10, 30]);
    expect(textoDelDesvio(0, true)).toEqual({ texto: "a tiempo", tono: "verde" });
    expect(textoDelDesvio(0, false)).toEqual({ texto: "on time", tono: "verde" });
    expect(textoDelDesvio(-5, true)).toEqual({ texto: "−5 min", tono: "verde" });
    expect(textoDelDesvio(10, true)).toEqual({ texto: "+10 min", tono: "verde" });
    expect(textoDelDesvio(11, true)).toEqual({ texto: "+11 min", tono: "ambar" });
    expect(textoDelDesvio(30, true)?.tono).toBe("ambar");
    expect(textoDelDesvio(31, true)).toEqual({ texto: "+31 min", tono: "rojo" });
    expect(textoDelDesvio(null, true)).toBeNull();
  });
});

describe("el Gestor lo lee, lo apunta y lo pinta", () => {
  const pagina = readFileSync("src/app/(app)/routes/page.tsx", "utf8").split("\r\n").join("\n");
  // **Puesto al día por D-NEXT (2026-11-06, migración 260)**: la prevista es la del plan vigente. Lo nuevo se sigue apuntando
  // sin pisar; lo pendiente de una ruta cuyo plan cambió se rehace (pisando), y sin la 260 en la base vale la regla de la 194.
  it("lee las del día que se mira y apunta solo HOY, quien usa el Gestor: lo nuevo sin pisar, lo de otro plan rehecho", () => {
    expect(pagina).toContain('createClient().from("delivery_eta_plans").select("delivery_id, kind, eta, plan_key, first_eta").eq("plan_date", dia)');
    expect(pagina).toContain('const apuntaEtas = !soloLectura && date === todayISO() && !!me && ["admin", "logistics", "manager", "accounting"].includes(me.role);');
    expect(pagina).toContain("const { nuevas, rehechas } = cambiosDeEtas(medidas, date, etasDelPlan, new Date().toISOString());");
    expect(pagina).toContain('const CONFLICTO = { onConflict: "delivery_id,plan_date,kind" } as const;');
    expect(pagina).toContain("await tabla().upsert(nuevas, { ...CONFLICTO, ignoreDuplicates: true })");
    expect(pagina).toContain("await tabla().upsert(rehechas, CONFLICTO)");
    // Solo se apunta una medida que es la de la forma de AHORA de esa ruta, con la clave de su plan.
    expect(pagina).toContain('if (estadoDeLaMedida(clave, delDiaDe(clave)) === "medida") medidas[clave] = { etas, plan: planDeLaRuta(clave) };');
  });
  it("sin la 260 (la base aún sin `plan_key`): se lee y se apunta como con la 194, la primera gana", () => {
    expect(pagina).toContain('createClient().from("delivery_eta_plans").select("delivery_id, kind, eta").eq("plan_date", dia)');
    expect(pagina).toContain("const primeras = filasNuevasDeEtas(routeEtas, date, etasDelPlan);");
    expect(pagina).toContain("upsert(primeras, { ...CONFLICTO, ignoreDuplicates: true })");
    expect(pagina).toContain("if (a.error || b.error) sinPlanVigente.current = true;");
  });
  it("la celda «Actual» es la de `celdaReal`; la fila hecha enseña la prevista en la llegada si «Actual» está a la vista", () => {
    expect(pagina).toContain('case "p_actual": return celdaReal(c.key, d, como.tipo, como.fueraDeOrden);');
    expect(pagina).toContain("const dif = fueraDeOrden ? null : textoDelDesvio(desvio(prevista, hora), lang === \"es\");");
    expect(pagina).toContain('llegada: colsParadas.some((x) => x.key === "p_actual")');
    expect(pagina).toContain("const g = etasDelPlan.get(claveDeEta(d.id, fp.tipo));");
    expect(pagina).toContain('data-hora-prevista={g?.eta ?? ""}');
    // Lo hecho fuera del orden de la lista lo dice, en vez de un «−357 min».
    expect(pagina).toContain("tipo: fp.tipo, sinAviso: true, fueraDeOrden: fueraDeOrden.has(claveDeEta(d.id, fp.tipo)),");
    expect(pagina).toContain('{fueraDeOrden && <span');
  });
  it("la 260: clave del plan, la primera del día aparte, y permiso para rehacer; sigue sin DELETE y sin `D-NEXT` en el SQL", () => {
    const sql = readFileSync("supabase/migrations/260_eta_del_plan_vigente.sql", "utf8").split("\r\n").join("\n");
    for (const col of ["plan_key text", "first_eta text", "plan_at timestamptz"]) expect(sql).toContain(`add column if not exists ${col}`);
    expect(sql).toContain("update public.delivery_eta_plans set first_eta = eta where first_eta is null;");
    expect(sql).toContain("grant update on public.delivery_eta_plans to authenticated;");
    expect(sql).toContain('create policy "delivery_eta_plans update" on public.delivery_eta_plans for update to authenticated');
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*delivery_eta_plans/i);
    expect(sql).not.toContain("D-NEXT");
    expect(sql).toContain("-- @ledger-below\ninsert into public.schema_migrations (name, checksum) values ('260_eta_del_plan_vigente.sql', '");
  });
  it("la 194: una fila por orden, día y parada; sin UPDATE ni DELETE", () => {
    const sql = readFileSync("supabase/migrations/194_eta_del_plan.sql", "utf8");
    expect(sql).toContain("primary key (delivery_id, plan_date, kind)");
    expect(sql).toContain("grant select, insert on public.delivery_eta_plans to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*update[^;]*delivery_eta_plans/i);
    expect(sql).toContain("(select public.current_user_role()) in ('admin', 'logistics', 'manager', 'accounting')");
  });
});

describe("«Actual» en el orden que alguien ya guardó (tanda `_v9`)", () => {
  it("entra justo DETRÁS de la llegada, esté donde esté; sin llegada en el orden, o si ya está, no se toca", () => {
    expect(conRealEnSuSitio(["p_windows", "p_type", "p_eta", "p_address"])).toEqual(["p_windows", "p_type", "p_eta", "p_actual", "p_address"]);
    expect(conRealEnSuSitio(["p_type", "p_address"])).toEqual(["p_type", "p_address"]);
    expect(conRealEnSuSitio(["p_actual", "p_eta"])).toEqual(["p_actual", "p_eta"]);
    expect(conRealEnSuSitio(null)).toBeNull();
  });
  it("quien ya pasó por `_v8` recibe la columna y su sitio, y se guarda una vez; con `_v9`, ya no", () => {
    const suyas = ["invoice", "p_type", "p_eta", "_v2", "_v3", "_v4", "_v5", "_v6", "_v7", "_v8"];
    const al = preferenciasDelGestorAlLeer(suyas, ["p_eta", "p_type"]);
    expect(al).toEqual({ columnas: [...suyas, "p_actual", "_v9"], orden: ["p_eta", "p_actual", "p_type"], escribe: true });
    expect(preferenciasDelGestorAlLeer(al.columnas!, al.orden).escribe).toBe(false);
  });
});
