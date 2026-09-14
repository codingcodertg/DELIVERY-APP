import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canReachHub, HUB_TOOLS } from "./constants";
import {
  buscaPersonas, departamentosDe, mailtoHref, normaliza, personasDe, telHref, tiendasDelDirectorio,
  type PersonaDirectorio,
} from "./phone-book";

// Dos clases de prueba, y no se mezclan: las que importan la función que corre —el orden y
// el agrupado de la cascada— y las que leen el `.sql`, que es texto y no una base
// ejecutándolo. Lo segundo importa aquí más de lo normal, porque lo que decide qué datos de
// una persona ve el resto de la empresa no está en la pantalla: está en la función.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/108_phone_book.sql");

const persona = (extra: Partial<PersonaDirectorio> = {}): PersonaDirectorio => ({
  full_name: "Ana", title: null, store: "McAllen", store_rank: 1, department: "Ventas",
  phone: null, ringcentral_ext: null, email: null, ...extra,
});

describe("la cascada: tiendas en el orden de Ajustes", () => {
  // El orden de Ajustes va A PROPÓSITO al revés del alfabeto. Con datos donde los dos
  // coinciden, esta prueba pasaría igual ordenando por nombre y no diría nada: medido, un
  // mutante que ordenaba alfabéticamente la dejaba en verde.
  const filas = [
    persona({ full_name: "Ana", store: "McAllen", store_rank: 0 }),
    persona({ full_name: "Beto", store: "Brownsville", store_rank: 1 }),
    persona({ full_name: "Caro", store: null, store_rank: null }),
    persona({ full_name: "Dani", store: "Weslaco", store_rank: null }),
  ];

  it("manda el orden de Ajustes, no el alfabeto", () => {
    expect(tiendasDelDirectorio(filas).map((g) => g.tienda)).toEqual(["McAllen", "Brownsville", "Weslaco", null]);
  });

  it("una tienda borrada de Ajustes no se traga a su gente: va detrás, con su nombre", () => {
    const grupos = tiendasDelDirectorio(filas);
    const weslaco = grupos.find((g) => g.tienda === "Weslaco");
    expect(weslaco?.personas).toBe(1);
  });

  it("quien no tiene tienda va al final, en su propio grupo", () => {
    expect(tiendasDelDirectorio(filas).at(-1)).toEqual({ tienda: null, personas: 1 });
  });

  it("cuenta a todo el mundo una sola vez", () => {
    const total = tiendasDelDirectorio(filas).reduce((n, g) => n + g.personas, 0);
    expect(total).toBe(filas.length);
  });
});

describe("la cascada: departamentos y personas", () => {
  const filas = [
    persona({ full_name: "Ana", department: "Ventas" }),
    persona({ full_name: "Zoe", department: "Ventas" }),
    persona({ full_name: "Beto", department: "Almacen" }),
    persona({ full_name: "Caro", department: null }),
    persona({ full_name: "Otro", store: "Brownsville", store_rank: 0, department: "Ventas" }),
  ];

  it("los departamentos son los de ESA tienda, alfabéticos y con «sin departamento» al final", () => {
    expect(departamentosDe(filas, "McAllen")).toEqual([
      { departamento: "Almacen", personas: 1 },
      { departamento: "Ventas", personas: 2 },
      { departamento: null, personas: 1 },
    ]);
  });

  it("las personas son las de esa tienda Y ese departamento, por nombre", () => {
    expect(personasDe(filas, "McAllen", "Ventas").map((p) => p.full_name)).toEqual(["Ana", "Zoe"]);
  });

  it("quien está en otra tienda con el mismo departamento no se cuela", () => {
    expect(personasDe(filas, "McAllen", "Ventas").some((p) => p.full_name === "Otro")).toBe(false);
    expect(personasDe(filas, "Brownsville", "Ventas").map((p) => p.full_name)).toEqual(["Otro"]);
  });

  it("«sin departamento» es un grupo al que se puede entrar, no un agujero", () => {
    expect(personasDe(filas, "McAllen", null).map((p) => p.full_name)).toEqual(["Caro"]);
  });
});

describe("el buscador salta la cascada", () => {
  const filas = [persona({ full_name: "Patricia Núñez" }), persona({ full_name: "Pedro Ramos" })];

  it("encuentra sin acentos y sin mayúsculas", () => {
    expect(buscaPersonas(filas, "nunez").map((p) => p.full_name)).toEqual(["Patricia Núñez"]);
    expect(buscaPersonas(filas, "PEDRO").map((p) => p.full_name)).toEqual(["Pedro Ramos"]);
  });

  it("sin texto NO devuelve la plantilla entera: eso sería el directorio plano que no se pidió", () => {
    expect(buscaPersonas(filas, "")).toEqual([]);
    expect(buscaPersonas(filas, "   ")).toEqual([]);
  });

  it("normaliza es la misma regla en los dos lados", () => {
    expect(normaliza("  ÁÉÍÓÚ ñ ")).toBe("aeiou n");
  });
});

describe("los enlaces de la tarjeta", () => {
  it("el teléfono se limpia para marcar, y conserva el prefijo internacional", () => {
    expect(telHref(" (956) 555-0134 ")).toBe("tel:9565550134");
    expect(telHref("+52 55 1234 5678")).toBe("tel:+525512345678");
  });

  it("sin teléfono o sin dígitos no hay enlace, para no pintar un botón muerto", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref("   ")).toBeNull();
    expect(telHref("ext. — ")).toBeNull();
  });

  it("el correo igual: enlace solo si parece un correo", () => {
    expect(mailtoHref(" ana@rdztilegroup.net ")).toBe("mailto:ana@rdztilegroup.net");
    expect(mailtoHref("no-es-un-correo")).toBeNull();
    expect(mailtoHref(null)).toBeNull();
  });
});

describe("108_phone_book.sql: qué expone la función, y qué no", () => {
  it("el fichero está y trae la función (control)", () => {
    expect(sql).toContain("create or replace function public.phone_book()");
  });

  it("expone EXACTAMENTE ocho columnas, y son las de una tarjeta de contacto", () => {
    const bloque = sql.slice(sql.indexOf("returns table ("), sql.indexOf(")\nlanguage sql"));
    const columnas = [...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columnas).toEqual([
      "full_name", "title", "store", "store_rank", "department", "phone", "ringcentral_ext", "email",
    ]);
  });

  it("y NO expone lo que RR. HH. guarda de puertas adentro", () => {
    const cuerpo = sql.slice(sql.indexOf("create or replace function public.phone_book()"));
    for (const columna of ["address", "birthday", "days_off", "notes", "employee_code", "date_hired"]) {
      expect(cuerpo, columna).not.toContain(`f.${columna}`);
    }
  });

  it("solo las personas activas: quien se fue desaparece el mismo día", () => {
    expect(sql).toMatch(/where\s+f\.date_left\s+is\s+null/);
  });

  it("es `security definer` con su `search_path` explícito y `pg_temp` al final", () => {
    expect(sql).toContain("security definer");
    expect(sql).toMatch(/set search_path = public, recruiting, pg_temp/);
  });

  it("la ejecuta quien tiene sesión, y nadie más", () => {
    expect(sql).toContain("revoke execute on function public.phone_book() from public, anon;");
    expect(sql).toContain("grant  execute on function public.phone_book() to authenticated;");
  });

  it("NO abre la tabla del expediente: la 094 se queda como está", () => {
    // Es la otra mitad de la decisión. Si esta migración creara una política de lectura
    // sobre `employee_files`, la fila entera quedaría expuesta y la función no habría
    // servido de nada.
    expect(sql).not.toMatch(/create policy[^;]*employee_files/i);
    expect(sql).not.toMatch(/grant\s+select[^;]*employee_files/i);
  });

  it("todo lo que añade es idempotente, que es lo que la deja correr dos veces", () => {
    for (const a of sql.match(/add column[^,;]*/g) ?? []) expect(a).toContain("if not exists");
  });

  it("no lleva el marcador de decisión sin numerar: su checksum la congela", () => {
    expect(sql).not.toContain("D-" + "NEXT");
  });
});

// El chofer: la puerta que no pasa por el hub.
//
// D-173 le cierra el hub sin condiciones y esa regla NO se relaja aquí — su app es su ruta. Lo
// que se hace es lo contrario de relajarla: se le da una puerta propia a una ruta que nunca
// estuvo detrás de ese candado. Las tres piezas tienen que estar a la vez, y por eso se prueban
// juntas: si la ruta se cerrara al chofer, el enlace sería un botón que rebota; si el enlace
// desapareciera, el chofer volvería a no tener forma de llegar; y si D-173 se hubiera relajado,
// esto habría dejado de ser una excepción acotada para convertirse en otra cosa.
describe("el chofer llega al directorio sin pasar por el hub", () => {
  const layout = leer("src/app/home/directory/layout.tsx");
  const chofer = leer("src/app/(app)/driver/page.tsx");

  it("la ruta del directorio solo pide sesión: ni rol, ni módulo, ni hub", () => {
    expect(layout).toContain("auth.getUser()");
    expect(layout).toContain('redirect("/login?next=/home/directory")');
    expect(layout).not.toContain("canReachHub");
    expect(layout).not.toContain("landingRoute");
    expect(layout).not.toMatch(/role\s*[!=]==?\s*"/);
  });

  it("y la pantalla del chofer tiene su enlace", () => {
    expect(chofer).toContain('href="/home/directory"');
  });

  it("D-173 sigue en pie: el hub NO se le abre al chofer", () => {
    expect(canReachHub({ role: "driver", module_access: ["deliveries", "timetracker"] })).toBe(false);
    expect(canReachHub({ role: "driver", module_access: ["deliveries", "erp", "recruiting"] })).toBe(false);
  });

  it("la herramienta del hub sigue siendo visible para todos, que es lo que la hace de todos", () => {
    const dir = HUB_TOOLS.find((t) => t.key === "directory")!;
    for (const role of ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"] as const) {
      expect(dir.visible({ role }), role).toBe(true);
    }
  });
});
