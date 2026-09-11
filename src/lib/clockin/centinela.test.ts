import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NADIE, NINGUNA_TIENDA, NO_MATCH } from "./scope";

// El último de la familia. `timeoff.ts` era el único de seis que filtraba por una lista de
// empleados sin el centinela: `if (ids) …in("employee_id", ids)`, y `[]` es verdadero, así que
// un gerente con tienda pero sin empleados en ella habría visto las ausencias y excepciones
// pendientes de toda la compañía. Preventivo —hoy hay cero `manager`— pero el más cercano a
// estar vivo: solo pide que el primer gerente tenga la tienda vacía, que es lo normal el día
// que se crea.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

const norm = (s: string) => s.split("\\").join("/");
const RAIZ = norm(process.cwd());
const rutas: string[] = [];
const recorre = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) recorre(p);
    else if ((f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test.")) rutas.push(norm(p).replace(RAIZ + "/", ""));
  }
};
recorre(join(process.cwd(), "src"));

describe("el centinela es un valor, no seis copias", () => {
  it("las dos listas salen de la misma constante", () => {
    expect(NO_MATCH).toEqual([NADIE]);
    expect(NINGUNA_TIENDA).toEqual([NADIE]);
    expect(NADIE).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  });

  it("nadie escribe el uuid de ceros a mano fuera de su definición", () => {
    // Estaba en seis sitios además de las dos definiciones. Ocho copias del mismo valor son
    // ocho sitios donde cambiarlo mal — y el que no se entere no falla, filtra distinto.
    const conLiteral = rutas.filter((r) => /0{8}-0{4}-0{4}-0{4}-0{12}/.test(sinComentarios(leer(r))));
    expect(conLiteral).toEqual(["src/lib/clockin/scope.ts"]);
    // Y en ese fichero, una sola vez: la definición.
    const enScope = sinComentarios(leer("src/lib/clockin/scope.ts")).match(/0{8}-0{4}-0{4}-0{4}-0{12}/g) ?? [];
    expect(enScope).toHaveLength(1);
  });
});

describe("nadie filtra por una lista que puede venir vacía sin centinela", () => {
  // El canario recorre en vez de enumerar: cualquier `.in("employee_id", …)` con una variable
  // tiene que llevar el centinela cerca, porque `[]` puede leerse como «sin filtro».
  const conFiltro = rutas.filter((r) => /\.in\("employee_id",\s*[A-Za-z_$]/.test(sinComentarios(leer(r))));

  it("los encuentra todos", () => {
    // Control: si el recorrido deja de ver ficheros, lo de abajo pasaría por vacuidad.
    expect(conFiltro.length).toBeGreaterThanOrEqual(5);
  });

  for (const ruta of conFiltro) {
    it(`${ruta.replace("src/app/timetracker/clock-in/", "")} — aplica el centinela`, () => {
      const src = sinComentarios(leer(ruta));
      // O pasa una variable que se calculó con el centinela, o lo aplica en la propia línea.
      expect(src, "filtra por ids sin centinela a la vista").toMatch(/\.length \? [A-Za-z_$][\w$]* : NO_MATCH/);
    });
  }
});

describe("timeoff.ts, el que faltaba", () => {
  const src = sinComentarios(leer("src/app/timetracker/clock-in/actions/timeoff.ts"));

  it("distingue «sin acotar» de «nadie»", () => {
    // `ids` null = el dueño, sin filtro. `ids` vacío = un gerente cuya tienda no tiene a
    // nadie: eso es «nadie», no «todos».
    expect(src).toMatch(/if \(ids\) \{/);
    expect(src).toMatch(/const inIds = ids\.length \? ids : NO_MATCH;/);
    expect(src).toMatch(/offQ\.in\("employee_id", inIds\)/);
    expect(src).toMatch(/excQ\.in\("employee_id", inIds\)/);
  });

  it("y ya no pasa `ids` crudo a ningún filtro", () => {
    expect(src).not.toMatch(/\.in\("employee_id", ids\)/);
  });
});
