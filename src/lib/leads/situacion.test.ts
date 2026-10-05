import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { categoriaBuena, cuentaPorSituacion, enSituacion, filtrar, SITUACIONES, situacionLabel, type Filtros, type Lead } from "./reglas";

let n = 0;
const lead = (x: Partial<Lead>): Lead => ({
  id: "l" + ++n, tabs_project: "T" + n, pool: "RDZ Pharr", category: "Sirve – usa piso", project_type: null, site_city: null,
  status: "free", last_outcome: null, ...x,
} as Lead);

const bueno = lead({});
const podria = lead({ category: "Might be useful" });
const noSirve = lead({ category: "No sirve – no lleva piso" });
const enRevision = lead({ status: "review", last_outcome: "review" });
const negado = lead({ last_outcome: "bad_lead", category: "No sirve – cadena / franquicia" });
const nada = lead({ last_outcome: "nothing", category: "Might be useful" });
const reasignar = lead({ last_outcome: "reassign", category: "Might be useful" });
const tomado = lead({ status: "taken", holder: "u1" });
const vendido = lead({ status: "won", holder: "u1", last_outcome: "sale" });
const archivado = lead({ status: "archived" });
const todos = [bueno, podria, noSirve, enRevision, negado, nada, reasignar, tomado, vendido, archivado];
const F: Filtros = { pool: "RDZ Pharr", vista: "libres", categoria: "utiles", tipo: "", ciudad: "", busca: "" };
const ids = (ls: Lead[]) => ls.map((l) => l.id);

describe("filtros por situación del lead (D-473)", () => {
  it("categoría buena es la que empieza por «Sirve»; «Might be useful» y «No sirve» no", () => {
    expect(categoriaBuena("Sirve – usa piso")).toBe(true);
    expect(categoriaBuena("  sirve – otra")).toBe(true);
    expect(categoriaBuena("Might be useful")).toBe(false);
    expect(categoriaBuena("No sirve – no lleva piso")).toBe(false);
    expect(categoriaBuena(null)).toBe(false);
  });

  it("cada situación trae lo suyo y nada más", () => {
    const de = (s: (typeof SITUACIONES)[number]) => ids(todos.filter((l) => enSituacion(l, s)));
    expect(de("buenos")).toEqual([bueno.id]);
    expect(de("revision")).toEqual([enRevision.id]);
    expect(de("negados")).toEqual([negado.id]);
    expect(de("nada")).toEqual([nada.id]);
    expect(de("reasignar")).toEqual([reasignar.id]);
    expect(de("tomados")).toEqual([tomado.id]);
    expect(de("vendidos")).toEqual([vendido.id]);
  });

  it("un lead bueno ya tomado o vendido no cuenta como «buenos»: son los que se pueden tomar", () => {
    expect(enSituacion(lead({ status: "taken" }), "buenos")).toBe(false);
    expect(enSituacion(lead({ status: "won" }), "buenos")).toBe(false);
  });

  it("un negado que alguien volvió a tomar ya no sale en «negados»", () => {
    expect(enSituacion(lead({ status: "taken", last_outcome: "bad_lead" }), "negados")).toBe(false);
    expect(enSituacion(lead({ status: "taken", last_outcome: "nothing" }), "nada")).toBe(false);
    expect(enSituacion(lead({ status: "taken", last_outcome: "reassign" }), "reasignar")).toBe(false);
  });

  it("con situación puesta, ni la vista «Libres» ni la categoría de entrada esconden lo pedido", () => {
    expect(ids(filtrar(todos, { ...F, situacion: "revision" }))).toEqual([enRevision.id]);
    expect(ids(filtrar(todos, { ...F, situacion: "tomados" }))).toEqual([tomado.id]);
    expect(ids(filtrar(todos, { ...F, situacion: "vendidos" }))).toEqual([vendido.id]);
    // el negado es de categoría «No sirve», que la categoría de entrada esconde
    expect(ids(filtrar(todos, { ...F, situacion: "negados" }))).toEqual([negado.id]);
  });

  it("una categoría elegida a mano sí sigue contando junto a la situación", () => {
    expect(ids(filtrar(todos, { ...F, situacion: "negados", categoria: "Might be useful" }))).toEqual([]);
    expect(ids(filtrar(todos, { ...F, situacion: "nada", categoria: "Might be useful" }))).toEqual([nada.id]);
  });

  it("sin situación todo sigue como antes", () => {
    expect(ids(filtrar(todos, F))).toEqual([bueno.id, podria.id, nada.id, reasignar.id]);
    expect(ids(filtrar(todos, { ...F, situacion: "" }))).toEqual(ids(filtrar(todos, F)));
  });

  it("los demás filtros (pool, búsqueda) siguen contando con situación", () => {
    expect(filtrar(todos, { ...F, pool: "RDZ Mission", situacion: "buenos" })).toEqual([]);
    expect(filtrar(todos, { ...F, busca: "no-existe", situacion: "buenos" })).toEqual([]);
  });

  it("la cuenta de cada filtro", () => {
    expect(cuentaPorSituacion(todos)).toEqual({ buenos: 1, revision: 1, negados: 1, nada: 1, reasignar: 1, tomados: 1, vendidos: 1 });
    expect(cuentaPorSituacion([])).toEqual({ buenos: 0, revision: 0, negados: 0, nada: 0, reasignar: 0, tomados: 0, vendidos: 0 });
  });

  it("cada situación tiene su texto en los dos idiomas, con las palabras del dueño", () => {
    expect(situacionLabel("revision", "es")).toBe("Ocupa revisión");
    expect(situacionLabel("negados", "es")).toBe("Negados");
    expect(situacionLabel("buenos", "es")).toBe("Buenos leads");
    for (const s of SITUACIONES) { expect(situacionLabel(s, "en")).not.toBe(""); expect(situacionLabel(s, "es")).not.toBe(""); }
  });

  it("la pantalla pinta un botón por situación y lo pasa al filtro", () => {
    const p = readFileSync("src/app/leads/Leads.tsx", "utf8");
    expect(p).toContain("data-situaciones");
    expect(p).toContain("SITUACIONES.map(");
    expect(p).toContain("cuentaPorSituacion(delPool)");
  });
});
