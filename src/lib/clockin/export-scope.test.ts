import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { visibleStores } from "./scope";

// El cuarto caso de la familia de D-234/D-235, y el primero que falla ABRIENDO: el export
// de informes leía el perfil DOS veces —una para el rol, validada, y otra para la tienda,
// que descartaba su error— y si fallaba la segunda, el acotado por tienda desaparecía y un
// gerente exportaba a toda la compañía. La RLS no lo contiene: la política de `profiles`
// es `using (true)` (099:39-41), así que ese acotado es de aplicación.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

/** Los objetos de los que cuelgan `role`, `store_id` y `extra_store_ids` en una llamada.
 * Antes se quitan los moldes de tipo y los paréntesis: `(me as { … }).extra_store_ids`
 * es `me`, y sin limpiarlo el identificador pegado al punto sería el cierre del molde. */
const objetosDe = (args: string): string[] => {
  const limpio = args
    .replace(/\s+as\s+\{[^}]*\}/g, "")
    .replace(/\s+as\s+[A-Za-z[\]|\s]+/g, "")
    .replace(/[()]/g, "");
  return [...limpio.matchAll(/\b([A-Za-z_$][\w$]*)\s*\??\.\s*(?:role|store_id|extra_store_ids)/g)].map((m) => m[1]);
};

const CSV = "src/app/timetracker/clock-in/api/reports/export/route.ts";
const XLSX = "src/app/timetracker/clock-in/api/reports/xlsx/route.ts";

describe("visibleStores no cambia: el null es del dueño", () => {
  it("un dueño no se acota, y un gerente con tienda ve la suya y las concedidas", () => {
    expect(visibleStores("owner", "t1", null)).toBeNull();
    expect(visibleStores("manager", "t1", ["t2"])).toEqual(["t1", "t2"]);
  });

  it("un gerente sin tienda devuelve null, que es «sin acotar» — por eso la ruta lo para", () => {
    // Esta es la línea que hacía peligroso el fallo de lectura, y sigue igual a propósito:
    // cambiarla afectaría a los otros cuatro sitios que la llaman. Lo que cambia es que
    // el export ya no deja que ese null se convierta en un informe de toda la compañía.
    expect(visibleStores("manager", null, ["t2"])).toBeNull();
  });
});

describe("las dos rutas de export", () => {
  for (const [nombre, ruta] of [["CSV", CSV], ["XLSX", XLSX]] as const) {
    describe(nombre, () => {
      const src = sinComentarios(leer(ruta));

      it("lee el perfil UNA sola vez", () => {
        // No se «valida» la segunda lectura: no existe. Era la única que nadie comprobaba.
        const lecturas = src.match(/from\("profiles"\)/g) ?? [];
        // Una para el perfil de quien llama, y la de la gente del informe.
        expect(lecturas.length, "más consultas a profiles de las esperadas").toBeLessThanOrEqual(2);
        expect(src).not.toContain("meStore");
      });

      it("el acotado sale de la MISMA lectura que validó el rol", () => {
        const llamada = src.match(/visibleStores\(([^;]*?)\)\s*;/s);
        expect(llamada, "no encontré la llamada a visibleStores").toBeTruthy();
        // Los tres argumentos tienen que colgar del mismo identificador. En el fallo, el
        // primero era `me.role` y el segundo `meStore?.store_id`: dos lecturas distintas.
        const objetos = objetosDe(llamada![1]);
        expect(objetos.length).toBeGreaterThanOrEqual(3);
        expect(new Set(objetos).size, `los argumentos vienen de ${[...new Set(objetos)].join(" y ")}`).toBe(1);
      });

      it("un fallo de lectura es 403, no un informe sin acotar", () => {
        expect(src).toMatch(/const \{ data: me, error: \w+ \} = await supabase/);
        const guarda = src.match(/if \((\w+) \|\| !me \|\| \(me\.role !== "manager" && me\.role !== "owner"\)\)/);
        expect(guarda, "la guarda del rol no mira el error").toBeTruthy();
        expect(src.slice(src.indexOf(guarda![0]))).toMatch(/status: 403/);
      });

      it("un gerente sin tienda no exporta: la falta de un dato acota, nunca amplía", () => {
        const i = src.indexOf('me.role === "manager" && !me.store_id');
        expect(i, "falta el corte del gerente sin tienda").toBeGreaterThan(0);
        expect(src.slice(i, i + 400)).toContain("no_store");
        expect(src.slice(i, i + 400)).toMatch(/status: 403/);
        // Y va ANTES de calcular el alcance: después ya no serviría de nada.
        expect(i).toBeLessThan(src.indexOf("visibleStores("));
      });
    });
  }
});

describe("nadie más alimenta visibleStores desde otra lectura", () => {
  // El canario de la familia: el peligro no estaba en el helper —que falla cerrado— sino
  // en quien lo alimenta. Recorre el árbol en vez de enumerar ficheros.
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
  const llamantes = rutas.filter((r) => /visibleStores\(\s*[\w$]/.test(leer(r)));

  it("los encuentra todos", () => {
    // Control: si el recorrido deja de ver ficheros, lo de abajo pasaría por vacuidad.
    expect(llamantes.length).toBeGreaterThanOrEqual(6);
  });

  for (const ruta of llamantes) {
    it(`${ruta.replace("src/", "")} — los tres argumentos salen del mismo objeto`, () => {
      const src = sinComentarios(leer(ruta));
      for (const m of src.matchAll(/visibleStores\(([^)]*(?:\)[^)]*)*?)\)\s*;/g)) {
        const objetos = objetosDe(m[1]);
        if (objetos.length === 0) continue;
        expect(new Set(objetos).size, `${ruta}: ${[...new Set(objetos)].join(" y ")}`).toBe(1);
      }
    });
  }
});
