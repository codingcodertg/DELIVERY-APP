import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_INFO, TITLE_COLORS, TITLE_MAX, personBadge, roleLabel } from "./constants";

// El dueño, señalando la pastilla «Gerente de Oficina» de una ficha: «ese tag es el que
// quiero poder cambiar y hacerlo como yo quiera». Por persona, no renombrando el rol.
//
// Lo que decide qué se pinta se importa (personBadge), no se copia: es la función que corre
// en las tres pantallas. Lo que se comprueba leyendo ficheros es dónde se usa y qué dice la
// migración, que ninguna función puede contestar.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

describe("personBadge", () => {
  it("sin título es exactamente la pastilla de antes, en los dos idiomas", () => {
    for (const lang of ["en", "es"] as const) {
      for (const role of Object.keys(ROLE_INFO) as (keyof typeof ROLE_INFO)[]) {
        const b = personBadge({ role }, lang);
        expect(b.text).toBe(roleLabel(role, lang));
        expect(b.color).toBe(ROLE_INFO[role].color);
      }
    }
  });

  it("el título manda, y no se traduce: mismo texto en inglés y en español", () => {
    const p = { role: "manager" as const, title: "Jefa de Piso", title_color: "--teal" };
    expect(personBadge(p, "en").text).toBe("Jefa de Piso");
    expect(personBadge(p, "es").text).toBe("Jefa de Piso");
    expect(personBadge(p, "en").color).toBe("var(--teal)");
  });

  it("un color fuera de la paleta no llega al style: cae al del rol", () => {
    // El valor acaba dentro de un `style` inline, así que esto no es cosmética.
    for (const malo of ["red", "var(--purple)", "url(javascript:alert(1))", "--nope", "", "  "]) {
      const b = personBadge({ role: "sales", title: "Ventas", title_color: malo }, "es");
      expect(b.color).toBe(ROLE_INFO.sales.color);
    }
    for (const bueno of TITLE_COLORS) {
      expect(personBadge({ role: "sales", title: "Ventas", title_color: bueno }, "es").color).toBe(`var(${bueno})`);
    }
  });

  it("un color guardado sin título no pinta nada", () => {
    const b = personBadge({ role: "driver", title: null, title_color: "--red" }, "es");
    expect(b.text).toBe(roleLabel("driver", "es"));
    expect(b.color).toBe(ROLE_INFO.driver.color);
  });

  it("solo espacios cuenta como vacío, y el largo se corta", () => {
    expect(personBadge({ role: "admin", title: "   " }, "en").text).toBe(roleLabel("admin", "en"));
    const largo = "x".repeat(TITLE_MAX + 25);
    expect(personBadge({ role: "admin", title: largo }, "en").text).toHaveLength(TITLE_MAX);
  });
});

describe("dónde se pinta la pastilla de una persona", () => {
  const SITIOS = [
    "src/components/UserDialog.tsx",
    "src/app/home/users/page.tsx",
    "src/app/(app)/account/page.tsx",
  ];

  it("los tres sitios de la insignia de una persona la piden a personBadge", () => {
    for (const f of SITIOS) {
      const src = sinComentarios(leer(f));
      expect(src, f).toContain("personBadge(");
      // Y ninguno pinta ya una pastilla con la etiqueta del rol a pelo.
      expect(src, f).not.toMatch(/className="sema"[^>]*>\{roleLabel\(/);
    }
  });

  it("las dos pastillas que NO son de una persona se quedan con el rol", () => {
    // Hay cuatro sitios que pintan `sema` + `roleLabel`. Dos describen a alguien y ya
    // usan personBadge; los otros dos hablan de un ROL, no de una persona:
    //   · TopBar: el conmutador «ver como», que debe decir el rol de verdad.
    //   · settings: la cabecera del bloque de permisos POR ROL, que se repite una vez
    //     por rol y no tiene ninguna persona detrás — un título ahí no significaría nada.
    for (const f of ["src/components/TopBar.tsx", "src/app/(app)/settings/page.tsx"]) {
      const src = sinComentarios(leer(f));
      expect(src, f).not.toContain("personBadge");
      expect(src, f).toContain("roleLabel(");
    }
  });

  it("las consultas que alimentan esas pantallas traen las dos columnas", () => {
    // Sin esto la pastilla se pintaría con el título en unas pantallas y con el rol en
    // otras, y el fallo sería mudo: `title` llegaría undefined, que es justo «sin título».
    for (const f of ["src/lib/data-provider.tsx", "src/app/(app)/layout.tsx"]) {
      const selects = leer(f).split("\n").filter((l) => l.includes(".select(") && l.includes("full_name"));
      expect(selects.length, f).toBeGreaterThan(0);
      for (const s of selects) {
        expect(s, f).toContain("title");
        expect(s, f).toContain("title_color");
      }
    }
  });

  it("el título lo escribe su propia función, nunca la del rol", () => {
    // Misma regla que D-053/D-057: la pastilla puede decir lo que sea, el rol sigue
    // decidiendo lo que la persona puede hacer.
    const dp = sinComentarios(leer("src/lib/data-provider.tsx"));
    const i = dp.indexOf("const updateUserTitle");
    const j = dp.indexOf("const updateUserStore");
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const cuerpo = dp.slice(i, j);
    expect(cuerpo).toContain('.update(patch)');
    expect(cuerpo).not.toContain("role");
  });
});

describe("104_profile_title.sql", () => {
  const sql = leer("supabase/migrations/104_profile_title.sql");

  it("añade las dos columnas nulas y no toca ninguna política RLS", () => {
    const addColumn = sql.match(/add column if not exists[^;]*/g) ?? [];
    expect(addColumn.join(" ")).toMatch(/title\s+text/);
    expect(addColumn.join(" ")).toMatch(/title_color\s+text/);
    // Nulas: si alguna naciera NOT NULL habria que rellenar 33 filas y todas cambiarian
    // de aspecto a la vez, que es justo lo contrario de «vacio = como hoy».
    for (const a of addColumn) expect(a.toLowerCase()).not.toContain("not null");
    expect(sql).not.toMatch(/create policy|drop policy|alter policy/);
  });

  it("la lista blanca de la base es EXACTAMENTE la del código", () => {
    // Dos listas que se pueden separar sin que nada avise: el `<select>` seguiría
    // ofreciendo un color que la base rechaza, o al revés.
    const m = sql.match(/title_color in\s*\(([^)]*)\)/);
    expect(m, "no encontré la restricción del color").toBeTruthy();
    const enSql = (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.slice(1, -1));
    expect([...enSql].sort()).toEqual([...TITLE_COLORS].sort());
  });

  it("el tope de largo es el mismo número que usa el campo", () => {
    const m = sql.match(/char_length\(title\)\s*<=\s*(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBe(TITLE_MAX);
  });

  it("el guard cubre las dos columnas nuevas además de las tres de 099", () => {
    // La RLS de 099 deja a cada quien editar SU fila, así que sin esto un vendedor se
    // pondría «Administrador» en la insignia, y en rojo.
    const i = sql.indexOf("create or replace function public.guard_profile_privileged_columns");
    expect(i).toBeGreaterThan(0);
    const cuerpo = sql.slice(i);
    for (const col of ["permissions", "store", "username", "title", "title_color"]) {
      expect(cuerpo, col).toMatch(new RegExp(`NEW\\.${col}\\s+is distinct from OLD\\.${col}`));
    }
    expect(cuerpo).toMatch(/current_user_role\(\), 'sales'\) <> 'admin'/);
  });

  it("se auto-registra en el ledger, como exige D-184", () => {
    const [, despues] = sql.split("-- @ledger-below");
    expect(despues).toBeTruthy();
    expect(despues).toContain("insert into public.schema_migrations");
    expect(despues).toContain("104_profile_title.sql");
  });
});
