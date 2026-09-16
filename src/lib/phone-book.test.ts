import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canReachHub, HUB_TOOLS } from "./constants";
import {
  buscaPersonas, CLAVE_REMOTE, CLAVE_SIN_TIENDA, claveTienda, departamentosDe, grupoDe, mailtoHref,
  normaliza, personasDe, saltaDepartamentos, telHref, tiendasDelDirectorio, type PersonaDirectorio,
} from "./phone-book";

// Dos clases de prueba, y no se mezclan: las que importan la función que corre —el orden y
// el agrupado de la cascada— y las que leen el `.sql`, que es texto y no una base
// ejecutándolo. Lo segundo importa aquí más de lo normal, porque lo que decide qué datos de
// una persona ve el resto de la empresa no está en la pantalla: está en la función.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");
const sql = leer("supabase/migrations/108_phone_book.sql");
const sql109 = leer("supabase/migrations/109_employee_file_store.sql");
const sql110 = leer("supabase/migrations/110_phone_book_con_contacto.sql");
const sql111 = leer("supabase/migrations/111_phone_book_grupos.sql");

// Cada migración redefine la función ENTERA, así que «lo que la función hace hoy» se mide
// siempre en la última que la toca —hoy la 111—, y los bloques de las anteriores quedan como
// historia de lo que cada una hizo, que sigue siendo cierto de esos ficheros.

/** El `.sql` sin sus comentarios: una prueba sobre el filtro mide el filtro, no lo que cuenta. */
const sinComentarios = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

/**
 * Recorta un trozo del `.sql` entre anclas, y REVIENTA si alguna falta. Un `indexOf` que
 * devuelve -1 no da error: devuelve un recorte absurdo, y las pruebas que miran ese recorte
 * pasan sin medir nada. Medido: con el recorte anterior, el mutante que exigía los tres datos
 * de contacto a la vez dejaba `contacto` en un carácter y la prueba del «o» pasaba igual.
 */
function corta(texto: string, a: { desde?: RegExp; tras?: RegExp; hasta?: RegExp }): string {
  let t = texto;
  for (const [clave, ancla] of [["desde", a.desde], ["tras", a.tras], ["hasta", a.hasta]] as const) {
    if (!ancla) continue;
    const m = ancla.exec(t);
    if (!m) throw new Error(`falta el ancla ${clave}: ${ancla}`);
    t = clave === "desde" ? t.slice(m.index)
      : clave === "tras" ? t.slice(m.index + m[0].length)
      : t.slice(0, m.index);
  }
  return t;
}

const persona = (extra: Partial<PersonaDirectorio> = {}): PersonaDirectorio => ({
  full_name: "Ana", title: null, store: "McAllen", store_rank: 1, department: "Ventas",
  phone: null, ringcentral_ext: null, email: null, directory_group: null, ...extra,
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
    expect(tiendasDelDirectorio(filas).at(-1)).toEqual({ clave: CLAVE_SIN_TIENDA, tipo: "sin_tienda", tienda: null, personas: 1 });
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
    expect(departamentosDe(filas, claveTienda("McAllen"))).toEqual([
      { departamento: "Almacen", personas: 1 },
      { departamento: "Ventas", personas: 2 },
      { departamento: null, personas: 1 },
    ]);
  });

  it("las personas son las de esa tienda Y ese departamento, por nombre", () => {
    expect(personasDe(filas, claveTienda("McAllen"), "Ventas").map((p) => p.full_name)).toEqual(["Ana", "Zoe"]);
  });

  it("quien está en otra tienda con el mismo departamento no se cuela", () => {
    expect(personasDe(filas, claveTienda("McAllen"), "Ventas").some((p) => p.full_name === "Otro")).toBe(false);
    expect(personasDe(filas, claveTienda("Brownsville"), "Ventas").map((p) => p.full_name)).toEqual(["Otro"]);
  });

  it("«sin departamento» es un grupo al que se puede entrar, no un agujero", () => {
    expect(personasDe(filas, claveTienda("McAllen"), null).map((p) => p.full_name)).toEqual(["Caro"]);
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

describe("109: la tienda del expediente entra en la función, para quien no tiene cuenta", () => {
  const cuerpo = sql109.slice(sql109.indexOf("create or replace function public.phone_book()"),
    sql109.indexOf("create or replace function public.store_names()"));

  it("el fichero está y redefine la función (control)", () => {
    expect(cuerpo).toContain("create or replace function public.phone_book()");
    expect(cuerpo.length).toBeGreaterThan(500);
  });

  it("misma firma: las mismas ocho columnas, en el mismo orden", () => {
    const bloque = cuerpo.slice(cuerpo.indexOf("returns table ("), cuerpo.indexOf(")\nlanguage sql"));
    const columnas = [...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columnas).toEqual([
      "full_name", "title", "store", "store_rank", "department", "phone", "ringcentral_ext", "email",
    ]);
  });

  it("la tienda es la de la cuenta y, si no la dice, la del expediente", () => {
    expect(cuerpo).toMatch(/coalesce\(\s*nullif\(btrim\(coalesce\(p\.store, ''\)\), ''\),\s*nullif\(btrim\(coalesce\(f\.store, ''\)\), ''\)\s*\) as tienda/);
  });

  it("y ESA tienda es la que se devuelve Y la que cruza con el orden de Ajustes", () => {
    // Si solo cambiara la columna, quien no tiene cuenta saldría bajo su tienda pero SIN rango,
    // detrás de todas las demás: el fallo que no se ve a simple vista.
    expect(cuerpo).toContain("x.tienda::text           as store,");
    expect(cuerpo).toContain("left join orden o on o.nombre = x.tienda;");
    expect(cuerpo).not.toContain("o.nombre = p.store");
  });

  it("sigue sin exponer lo de puertas adentro, y sigue solo con las activas", () => {
    for (const col of ["address", "birthday", "days_off", "notes", "employee_code", "date_hired"]) {
      // `String.raw`: dentro de una plantilla normal, la secuencia de límite de palabra es el
      // carácter RETROCESO, no un límite, y la prueba no podía fallar nunca. Lo midió otra
      // sesión: pasaba igual con una columna privada dentro del cuerpo.
      expect(cuerpo, col).not.toMatch(new RegExp(String.raw`\b${col}\b`));
    }
    expect(cuerpo).toMatch(/where\s+f\.date_left\s+is\s+null/);
  });

  it("conserva `security definer`, su `search_path` y los permisos", () => {
    expect(cuerpo).toContain("security definer");
    expect(cuerpo).toContain("set search_path = public, recruiting, pg_temp");
    expect(sql109).toContain("revoke execute on function public.phone_book() from public, anon;");
    expect(sql109).toContain("grant  execute on function public.phone_book() to authenticated;");
  });

  it("la columna nueva es idempotente y no se abre la tabla del expediente", () => {
    expect(sql109).toContain("add column if not exists store text;");
    expect(sql109).not.toMatch(/create policy[^;]*employee_files/i);
    expect(sql109).not.toMatch(/grant\s+select[^;]*employee_files/i);
  });
});

describe("109: la lista de tiendas para elegir expone nombre y orden, nada más", () => {
  const fn = sql109.slice(sql109.indexOf("create or replace function public.store_names()"));

  it("devuelve exactamente dos columnas: nombre y posición", () => {
    const bloque = fn.slice(fn.indexOf("returns table ("), fn.indexOf(")\nlanguage sql"));
    expect([...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1])).toEqual(["name", "rank"]);
  });

  it("no saca direcciones, coordenadas ni la aprobación automática", () => {
    const cuerpo = fn.slice(fn.indexOf("as $$"), fn.indexOf("$$;"));
    for (const k of ["address", "lat", "lng", "auto_approve"]) expect(cuerpo, k).not.toContain(k);
  });

  it("es `security definer` con `search_path` y la ejecuta solo quien tiene sesión", () => {
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path = public, pg_temp");
    expect(sql109).toContain("revoke execute on function public.store_names() from public, anon;");
    expect(sql109).toContain("grant  execute on function public.store_names() to authenticated;");
  });

  it("no lleva el marcador de decisión sin numerar: su checksum la congela", () => {
    expect(sql109).not.toContain("D-" + "NEXT");
  });
});

// Lo que hizo la 110, que sigue siendo cierto de ese fichero. La definicion vigente ya no es
// esta: la 111 cambio el filtro y la firma, y se mide en su propio bloque.
describe("110: el directorio solo enseña a quien tiene algo que enseñar", () => {
  // Esto mide el TEXTO del `.sql`, no una base ejecutándolo: cuando se escribe, la migración no
  // está aplicada. Lo que fija es la forma del filtro —sobre qué columnas decide y sobre cuáles
  // no—, que es donde caben los dos errores que importan. Las consultas de solo lectura para
  // confirmarlo contra la base están al final del propio `.sql`.
  const cuerpo = sinComentarios(corta(sql110, { desde: /create or replace function public\.phone_book\(\)/ }));

  // El filtro de la CTE `personas`: del `from` de la tabla al cierre de la CTE. Se corta
  // ANTES del `select` de la CTE a propósito, para que la prueba del departamento mida el
  // FILTRO y no la columna que se devuelve — que sigue estando, y tiene que seguir.
  const filtro = corta(cuerpo, {
    desde: /from recruiting\.employee_files f/,
    hasta: /\n {2}\)\n {2}select/,
  });
  // Lo que el `where` exige ADEMÁS de que la persona siga activa. Se ancla en la condición de
  // `date_left`, no en la forma del filtro: así un filtro reescrito de otra manera se sigue
  // midiendo, en vez de desaparecer del recorte y dejar las pruebas en verde por nada.
  const contacto = corta(filtro, { tras: /where\s+f\.date_left\s+is\s+(?:not\s+)?null/ });

  it("el fichero está, redefine la función, y el filtro se encontró (control)", () => {
    expect(cuerpo).toContain("create or replace function public.phone_book()");
    expect(filtro).toMatch(/where\s+f\.date_left\s+is\s+null/);
    expect(contacto).toContain("is not null");
    expect(contacto.length).toBeGreaterThan(50);
  });

  it("misma firma: las mismas ocho columnas, en el mismo orden", () => {
    const bloque = cuerpo.slice(cuerpo.indexOf("returns table ("), cuerpo.indexOf(")\nlanguage sql"));
    const columnas = [...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columnas).toEqual([
      "full_name", "title", "store", "store_rank", "department", "phone", "ringcentral_ext", "email",
    ]);
  });

  it("decide sobre los TRES campos de contacto, y sobre ninguno más", () => {
    // Set, no texto: una reescritura del filtro que siga mirando estas tres columnas —y solo
    // estas— pasa. La que se deja una fuera, no: quien solo tuviera ESE dato desaparecería.
    const columnas = [...contacto.matchAll(/f\.(\w+)/g)].map((m) => m[1]).sort();
    expect(columnas).toEqual(["email", "phone", "ringcentral_ext"]);
  });

  it("el departamento NO decide: sin departamento pero con extensión, se queda", () => {
    // El caso con nombre: Edgar Ayala no tiene departamento, tiene la extensión 332, y sale en
    // Pharr. Es la diferencia entre «no hay nada que enseñar» y «no tiene departamento», y con
    // los datos de hoy NO se puede distinguir midiendo la base: las cuatro personas sin
    // contacto son también las cuatro sin departamento, así que los dos filtros darían el mismo
    // número. Lo que separa un filtro del otro es esta prueba.
    expect(filtro).not.toMatch(/\bdepartment\b/);
  });

  it("basta con uno de los tres: es un «o», no un «y»", () => {
    // Un mutante que encadene las tres condiciones con `and` exige los tres datos y vacía el
    // directorio hasta dejar solo a quien lo tiene todo. Se mide en el tramo que va de la
    // primera columna a la última, para no depender de en qué orden se escribieron.
    const entreRamas = contacto.slice(contacto.indexOf("f."), contacto.lastIndexOf("f."));
    expect(entreRamas).not.toMatch(/\band\b/i);
  });

  it("un espacio en blanco no es un dato de contacto", () => {
    // Misma regla que la tienda en la 109. Sin el `btrim`, una extensión con un espacio colaría
    // a alguien en el directorio con una tarjeta igual de vacía.
    const saneados = contacto.match(/nullif\(btrim\(coalesce\(f\.\w+, ''\)\), ''\)/g) ?? [];
    expect(saneados).toHaveLength(3);
  });

  it("nadie se marca como dado de baja para esconderlo: la migración no escribe nada", () => {
    // `date_left` es la fecha en que alguien se fue. Usarla para tapar una ficha incompleta
    // sería escribir una mentira en el expediente para arreglar una pantalla.
    expect(sql110).not.toMatch(/\bdate_left\s+is\s+not\s+null\b/);
    expect(sql110).not.toMatch(/\bset\s+date_left\b/i);
    for (const escritura of [/insert\s+into\s+recruiting/i, /update\s+recruiting/i, /delete\s+from\s+recruiting/i]) {
      expect(sql110, String(escritura)).not.toMatch(escritura);
    }
  });

  it("la tienda de la 109 sobrevive entera, en los dos sitios donde se usa", () => {
    // `create or replace` reemplaza la función entera: lo que esta migración no copie, se pierde
    // en producción. El fallo silencioso es copiar la columna y olvidar el cruce con Ajustes.
    expect(cuerpo).toMatch(/coalesce\(\s*nullif\(btrim\(coalesce\(p\.store, ''\)\), ''\),\s*nullif\(btrim\(coalesce\(f\.store, ''\)\), ''\)\s*\) as tienda/);
    expect(cuerpo).toContain("x.tienda::text           as store,");
    expect(cuerpo).toContain("left join orden o on o.nombre = x.tienda;");
    expect(cuerpo).not.toContain("o.nombre = p.store");
  });

  it("sigue sin exponer lo que RR. HH. guarda de puertas adentro", () => {
    for (const col of ["address", "birthday", "days_off", "notes", "employee_code", "date_hired"]) {
      // `String.raw`, no plantilla normal: ahí la secuencia de límite de palabra es el carácter
      // RETROCESO y el `not.toMatch` no podría fallar nunca (está contado en D-258).
      expect(cuerpo, col).not.toMatch(new RegExp(String.raw`\b${col}\b`));
    }
  });

  it("conserva `security definer`, su `search_path` y los permisos", () => {
    expect(cuerpo).toContain("security definer");
    expect(cuerpo).toContain("set search_path = public, recruiting, pg_temp");
    expect(sql110).toContain("revoke execute on function public.phone_book() from public, anon;");
    expect(sql110).toContain("grant  execute on function public.phone_book() to authenticated;");
  });

  it("no abre la tabla del expediente ni de paso", () => {
    expect(sql110).not.toMatch(/create policy[^;]*employee_files/i);
    expect(sql110).not.toMatch(/grant\s+select[^;]*employee_files/i);
  });

  it("se auto-registra en el ledger, como exige D-184", () => {
    const [, despues] = sql110.split("-- @ledger-below");
    expect(despues).toContain("insert into public.schema_migrations");
    expect(despues).toContain("110_phone_book_con_contacto.sql");
  });

  it("no lleva el marcador de decisión sin numerar: su checksum la congela", () => {
    expect(sql110).not.toContain("D-" + "NEXT");
  });
});

// La cascada con grupos (111). Datos neutros a propósito: ni nombres ni códigos de tienda del
// dueño, que viven en Ajustes y no se afirman en el repo.
describe("111: los grupos Remote y Sin tienda en la cascada", () => {
  // Las filas como las manda la base: una fila de grupo llega SIN tienda y sin rango. Es la
  // entrada real, y es la que hace caer al mutante que mira la tienda vacía antes que el grupo.
  const filas = [
    persona({ full_name: "Ana", store: "AAA", store_rank: 3 }),
    persona({ full_name: "Beto", store: "BBB", store_rank: 1 }),
    persona({ full_name: "Rita", store: null, store_rank: null, department: null, directory_group: "remote" }),
    persona({ full_name: "Raul", store: null, store_rank: null, department: null, directory_group: "remote" }),
    persona({ full_name: "Sara", store: null, store_rank: null, department: "Ventas", directory_group: "sin_tienda" }),
  ];

  it("tiendas por su rango, luego Remote, y Sin tienda al final", () => {
    expect(tiendasDelDirectorio(filas).map((g) => g.clave)).toEqual([
      claveTienda("BBB"), claveTienda("AAA"), CLAVE_REMOTE, CLAVE_SIN_TIENDA,
    ]);
  });

  it("Remote llega sin tienda y va a Remote, no a «Sin tienda»", () => {
    const remote = tiendasDelDirectorio(filas).find((g) => g.clave === CLAVE_REMOTE);
    expect(remote).toEqual({ clave: CLAVE_REMOTE, tipo: "remote", tienda: null, personas: 2 });
    expect(tiendasDelDirectorio(filas).find((g) => g.clave === CLAVE_SIN_TIENDA)?.personas).toBe(1);
  });

  it("dos tiendas que comparten código son un solo grupo, en el rango menor", () => {
    // La base ya las manda con el mismo `store`; aquí basta con que no se separen y con que el
    // grupo tome el MENOR rango. Primero, último y menor son distintos a propósito (4, 2, 5), y
    // la otra tienda cae en medio (3): quedarse con la primera o la última fila la adelantaría.
    const fundidas = [
      persona({ full_name: "Uno", store: "CCC", store_rank: 4 }),
      persona({ full_name: "Dos", store: "CCC", store_rank: 2 }),
      persona({ full_name: "Cuatro", store: "CCC", store_rank: 5 }),
      persona({ full_name: "Tres", store: "DDD", store_rank: 3 }),
    ];
    expect(tiendasDelDirectorio(fundidas).map((g) => [g.tienda, g.personas])).toEqual([["CCC", 3], ["DDD", 1]]);
  });

  it("una tienda que se llamara como un grupo no se mezcla con él", () => {
    const raras = [
      persona({ full_name: "Uno", store: "remote", store_rank: 1 }),
      persona({ full_name: "Dos", store: null, store_rank: null, directory_group: "remote" }),
    ];
    expect(tiendasDelDirectorio(raras).map((g) => g.personas)).toEqual([1, 1]);
  });

  it("sin departamentos, el nivel se salta: Remote no es «Remote → Sin departamento»", () => {
    expect(saltaDepartamentos(filas, CLAVE_REMOTE)).toBe(true);
    expect(personasDe(filas, CLAVE_REMOTE, null).map((p) => p.full_name)).toEqual(["Raul", "Rita"]);
  });

  it("con un departamento de verdad, el nivel se queda", () => {
    expect(saltaDepartamentos(filas, CLAVE_SIN_TIENDA)).toBe(false);
    expect(saltaDepartamentos(filas, claveTienda("AAA"))).toBe(false);
    // Uno con departamento y otro sin él: dos opciones, así que tampoco se salta.
    const mezcla = [...filas, persona({ full_name: "Rosa", store: null, store_rank: null, department: "Soporte", directory_group: "remote" })];
    expect(saltaDepartamentos(mezcla, CLAVE_REMOTE)).toBe(false);
  });

  it("el grupo de una fila dice su sitio también fuera de la cascada (búsqueda y tarjeta)", () => {
    expect(grupoDe(filas[2]).tipo).toBe("remote");
    expect(grupoDe(filas[4]).tipo).toBe("sin_tienda");
    expect(grupoDe(filas[0])).toEqual({ clave: claveTienda("AAA"), tipo: "tienda", tienda: "AAA" });
  });
});

// La definicion VIGENTE de la funcion vive en la 111, que la borra y la crea con una columna mas.
describe("111: solo con extensión, grupos por rol y código de tienda", () => {
  // Esto mide el TEXTO del `.sql`, no una base ejecutándolo: cuando se escribe, la migración no
  // está aplicada. La matriz por rol, de solo lectura y con ROLLBACK, está al final del fichero.
  const cuerpo = sinComentarios(corta(sql111, { desde: /create function public\.phone_book\(\)/, hasta: /^\$\$;$/m }));
  const cabecera = sinComentarios(corta(sql111, { hasta: /create function public\.phone_book\(\)/ }));
  const filtro = corta(cuerpo, { desde: /from recruiting\.employee_files f/, hasta: /\n {2}\),\n {2}clasificadas/ });
  const contacto = corta(filtro, { tras: /where\s+f\.date_left\s+is\s+(?:not\s+)?null/ });
  const clasifica = corta(cuerpo, { desde: /clasificadas as \(/, hasta: /\n {2}\),\n {2}quien/ });
  const final = corta(cuerpo, { desde: /\n {2}from clasificadas c/ });
  const disyuncion = (grupo: string) => corta(final, { desde: new RegExp(`\\(c\\.grupo = '${grupo}'`), hasta: /\)\s*(?:\n|;|$)/ });

  it("el fichero está y los recortes se encontraron (control)", () => {
    expect(cuerpo).toContain("security definer");
    expect(contacto).toContain("is not null");
    expect(clasifica).toContain("case");
    expect(final).toContain("where");
  });

  it("la firma son nueve columnas: las ocho de siempre y `directory_group` al final", () => {
    const bloque = corta(cuerpo, { tras: /returns table \(/, hasta: /\)\nlanguage sql/ });
    const columnas = [...bloque.matchAll(/^\s{2}(\w+)\s/gm)].map((m) => m[1]);
    expect(columnas).toEqual([
      "full_name", "title", "store", "store_rank", "department", "phone", "ringcentral_ext", "email", "directory_group",
    ]);
  });

  it("como la firma cambia, se borra antes de crear y los permisos se vuelven a dar después", () => {
    const drop = sql111.indexOf("drop function if exists public.phone_book();");
    const create = sql111.indexOf("create function public.phone_book()");
    const revoke = sql111.indexOf("revoke execute on function public.phone_book() from public, anon;");
    const grant = sql111.indexOf("grant  execute on function public.phone_book() to authenticated;");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
    expect(revoke).toBeGreaterThan(create);
    expect(grant).toBeGreaterThan(create);
  });

  it("solo decide la extensión: ni teléfono ni correo bastan ya", () => {
    // Con los datos de hoy el filtro de la 110 y este dejan a las mismas personas, así que
    // la base no los distingue. Esto sí.
    expect([...contacto.matchAll(/f\.(\w+)/g)].map((m) => m[1])).toEqual(["ringcentral_ext"]);
    expect(contacto).toMatch(/nullif\(btrim\(coalesce\(f\.ringcentral_ext, ''\)\), ''\) is not null/);
  });

  it("Remote gana a la falta de tienda, y sin tienda resuelta se va a «Sin tienda»", () => {
    const remote = clasifica.indexOf("when x.directory_group = 'remote' then 'remote'");
    const sinTienda = clasifica.search(/when x\.directory_group = 'sin_tienda' or x\.tienda is null then 'sin_tienda'/);
    expect(remote).toBeGreaterThan(-1);
    expect(sinTienda).toBeGreaterThan(remote);
  });

  it("Remote lo ven manager y admin; «Sin tienda», solo admin", () => {
    // «o», en cualquier orden: con «y» no lo vería nadie, porque nadie es admin y manager a la vez.
    expect(disyuncion("remote")).toMatch(/q\.admin or q\.manager|q\.manager or q\.admin/);
    expect(disyuncion("sin_tienda")).toMatch(/q\.admin/);
    expect(disyuncion("sin_tienda")).not.toMatch(/manager/);
    // Y nada más abre filas: tres ramas, la de tienda sin condición de rol.
    expect(final.match(/\bor\b/g)?.length).toBe(3);
    expect(final).toMatch(/where c\.grupo is null\n/);
  });

  it("los roles salen de los helpers que existen, y sin sesión cuentan como no", () => {
    const quien = corta(cuerpo, { desde: /quien as \(/, hasta: /\n {2}\)\n {2}select/ });
    expect(quien).toContain("coalesce(public.is_admin(), false)");
    expect(quien).toContain("coalesce(public.current_user_role() = 'manager', false)");
  });

  it("una fila de grupo no lleva la tienda de la cuenta ni su rango", () => {
    // `profiles.store` sigue acotando Entregas; si viajara aquí, la tarjeta diría una tienda
    // y la cascada otra.
    expect(cuerpo).toMatch(/case when c\.grupo is null then coalesce\(o\.codigo, c\.tienda\) end::text\s+as store,/);
    expect(cuerpo).toMatch(/case when c\.grupo is null then o\.rank end\s+as store_rank,/);
  });

  it("el código de Ajustes sustituye al nombre, y las que lo comparten van en el rango menor", () => {
    expect(cuerpo).toMatch(/coalesce\(\s*nullif\(btrim\(coalesce\(s\.value->>'directory_code', ''\)\), ''\),\s*s\.value->>'name'\s*\) as codigo/);
    expect(cuerpo).toContain("min(t.rank) over (partition by t.codigo) as rank");
    // El cruce sigue siendo por NOMBRE: la tienda de una persona es un nombre, no un código.
    expect(cuerpo).toContain("left join orden o on o.nombre = c.tienda");
  });

  it("ni un nombre ni un código de tienda escrito en la función: son datos del dueño", () => {
    const literales = [...cuerpo.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const permitidos = new Set(["", "name", "directory_code", "[]", "remote", "sin_tienda", "manager", "—"]);
    expect(literales.filter((l) => !permitidos.has(l))).toEqual([]);
  });

  it("la tienda de la 109 y `date_left` siguen como estaban", () => {
    expect(cuerpo).toMatch(/coalesce\(\s*nullif\(btrim\(coalesce\(p\.store, ''\)\), ''\),\s*nullif\(btrim\(coalesce\(f\.store, ''\)\), ''\)\s*\) as tienda/);
    expect(filtro).toMatch(/where\s+f\.date_left\s+is\s+null/);
  });

  it("la columna nueva: idempotente, y solo acepta los dos grupos", () => {
    expect(cabecera).toContain("add column if not exists directory_group text;");
    expect(cabecera).toMatch(/if not exists \(\s*select 1 from pg_constraint/);
    expect(cabecera).toContain("check (directory_group in ('remote', 'sin_tienda'))");
  });

  it("no escribe datos, no toca `profiles.store` y no abre el expediente", () => {
    // Sin comentarios: la matriz por rol del final lleva un `update` de ejemplo, comentado, que
    // corre el orquestador dentro de una transacción con ROLLBACK. Lo que se aplica no escribe.
    const ejecutable = sinComentarios(sql111);
    for (const escritura of [/insert\s+into\s+recruiting/i, /update\s+recruiting/i, /delete\s+from/i, /update\s+public\.profiles/i]) {
      expect(ejecutable, String(escritura)).not.toMatch(escritura);
    }
    expect(sql111).not.toMatch(/create policy[^;]*employee_files/i);
    expect(sql111).not.toMatch(/grant\s+select[^;]*employee_files/i);
  });

  it("sigue sin exponer lo que RR. HH. guarda de puertas adentro", () => {
    for (const col of ["address", "birthday", "days_off", "notes", "employee_code", "date_hired"]) {
      expect(cuerpo, col).not.toMatch(new RegExp(String.raw`\b${col}\b`));
    }
  });

  it("conserva `security definer` y su `search_path`", () => {
    expect(cuerpo).toContain("set search_path = public, recruiting, pg_temp");
  });

  it("se auto-registra en el ledger y no lleva el marcador sin numerar", () => {
    const [, despues] = sql111.split("-- @ledger-below");
    expect(despues).toContain("111_phone_book_grupos.sql");
    expect(sql111).not.toContain("D-" + "NEXT");
  });
});

describe("111: solo un admin de RR. HH. cambia la marca de grupo", () => {
  // La RLS de la 094 deja escribir el expediente entero a admin Y gerente de RR. HH.; la ficha
  // limita el selector, pero un gerente por REST directo no pasa por la ficha. Mide el TEXTO del
  // guard; la prueba por rol, con ROLLBACK, está al final del `.sql`.
  const guard = sinComentarios(corta(sql111, {
    desde: /create or replace function recruiting\.guard_employee_file_link\(\)/,
    hasta: /end \$\$;/,
  }));
  const primeraSalida = guard.indexOf("return NEW");

  it("el guard está en la 111 y parte de la 106 (control)", () => {
    expect(guard).toContain("security definer set search_path = recruiting, public");
    expect(guard).toContain("raise exception 'Only an HR admin can link or unlink an employee file to an account'");
    expect(primeraSalida).toBeGreaterThan(-1);
  });

  it("mira las DOS columnas antes de la primera salida", () => {
    // La 106 salía en cuanto `profile_id` no cambiaba. Una comprobación del grupo puesta detrás
    // de esa salida no se ejecutaría nunca en un update que solo toca el grupo.
    for (const asignacion of [
      /cambia_enlace := NEW\.profile_id is not null;/,
      /cambia_grupo\s+:= NEW\.directory_group is not null;/,
      /cambia_enlace := NEW\.profile_id is distinct from OLD\.profile_id;/,
      /cambia_grupo\s+:= NEW\.directory_group is distinct from OLD\.directory_group;/,
    ]) {
      const m = asignacion.exec(guard);
      expect(m, String(asignacion)).not.toBeNull();
      expect(m!.index, String(asignacion)).toBeLessThan(primeraSalida);
    }
    expect(guard.slice(0, primeraSalida + "return NEW".length)).toMatch(/if not \(cambia_enlace or cambia_grupo\) then return NEW/);
  });

  it("la salida de los triggers anidados vale para el enlace, no para el grupo", () => {
    expect(guard).toMatch(/if pg_trigger_depth\(\) > 1 and not cambia_grupo then return NEW;/);
  });

  it("solo el admin de RR. HH.: el gerente, que sí puede escribir el expediente, no", () => {
    expect(guard).toContain("if coalesce(public.current_recruiting_role(), '') <> 'admin' then");
    expect(guard).not.toMatch(/manager/);
    expect(guard).toContain("raise exception 'Only an HR admin can change the directory group of an employee file'");
  });

  it("no rehace el trigger: `create or replace function` conserva el enlace de la 106", () => {
    expect(sinComentarios(sql111)).not.toMatch(/create trigger/i);
    expect(sinComentarios(sql111)).not.toMatch(/drop trigger/i);
  });

  it("cada bloque `$$` que se abre se cierra", () => {
    // Medido al escribirla: una edición con `String.replace` convirtió `$$` en `$` y dejó el
    // guard como SQL inválido. Lo cazó un recorte que no encontró su ancla; esto lo dice directo.
    const ejecutable = sinComentarios(sql111);
    const abren = ejecutable.match(/\b(?:as|do) \$\$$/gm) ?? [];
    const cierran = ejecutable.match(/^\s*(?:end )?\$\$;$/gm) ?? [];
    expect(abren.length).toBe(3);
    expect(cierran.length).toBe(abren.length);
  });

  it("la columna existe antes que el guard que la lee", () => {
    expect(sql111.indexOf("add column if not exists directory_group text;"))
      .toBeLessThan(sql111.indexOf("create or replace function recruiting.guard_employee_file_link()"));
  });
});
