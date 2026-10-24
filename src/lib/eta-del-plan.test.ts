import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { A_TIEMPO_MIN, TARDE_MIN, claveDeEta, desvio, filasNuevasDeEtas, mapaDeEtas, textoDelDesvio } from "./eta-del-plan";
import { conRealEnSuSitio, preferenciasDelGestorAlLeer } from "./routes-columns";
import { claveDeRecogida } from "./usa-medida-de-rutas";

/* D-NEXT (194). Roberto, 2026-10-24, en la tabla de paradas del Gestor: «Need a column of "Actual" to know when they
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
  it("lee las del día que se mira y apunta solo HOY, sin pisar (ignoreDuplicates), quien usa el Gestor", () => {
    expect(pagina).toContain('createClient().from("delivery_eta_plans").select("delivery_id, kind, eta").eq("plan_date", date)');
    expect(pagina).toContain('const apuntaEtas = !soloLectura && date === todayISO() && !!me && ["admin", "logistics", "manager", "accounting"].includes(me.role);');
    expect(pagina).toContain("const nuevas = filasNuevasDeEtas(routeEtas, date, etasDelPlan);");
    expect(pagina).toContain('.upsert(nuevas, { onConflict: "delivery_id,plan_date,kind", ignoreDuplicates: true })');
  });
  it("la celda «Actual» es la de `celdaReal`; la fila hecha enseña la prevista en la llegada si «Actual» está a la vista", () => {
    expect(pagina).toContain('case "p_actual": return celdaReal(c.key, d, como.tipo);');
    expect(pagina).toContain("const dif = textoDelDesvio(desvio(prevista, hora), lang === \"es\");");
    expect(pagina).toContain('llegada: colsParadas.some((x) => x.key === "p_actual")');
    expect(pagina).toContain("data-hora-prevista={etasDelPlan.get(claveDeEta(d.id, fp.tipo)) ?? \"\"}");
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
