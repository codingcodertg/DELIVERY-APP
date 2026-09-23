import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { huellaDeLectura, type ProductoPromo, type ResultadoPromo } from "./excel";
import {
  etiquetaDeRonda, filasParaGuardar, gruposDeAjustes, LIMITES,
  problemaDeLoLeido, problemaDelFichero, resumenParaPantalla,
} from "./subida";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");

/**
 * Lo que la PROSA dice no cuenta. Esta prueba mira si `preview` **usa** la llave de servicio, y sin
 * esto bastaba con que un comentario nombrara la función para que la prueba se pusiera roja — o,
 * peor, que alguien la relajara para callarla. Misma forma que en `map-legend.test.ts`.
 */
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

const producto = (extra: Partial<ProductoPromo> = {}): ProductoPromo => ({
  code: "X1", supplier: "PROV", size: "8X48", description: "DESCRIPCION", notes: null,
  qoh: 100, demand: 10, monthsOfStock: 5, qohByStore: { AA1: 1, BB2: 2 },
  cost: 1.5, price: 2.5, diff: 1, sourceSheet: "TODO", rowNo: 3, ...extra,
});

const resultado = (extra: Partial<ResultadoPromo> = {}): ResultadoPromo => ({
  productos: [producto()], sugerencias: [], avisos: [], ...extra,
});

// ===========================================================================
describe("la huella: que lo que se confirma sea lo que se vio", () => {
  it("la misma lectura da la misma huella, y son ocho dígitos hex", () => {
    expect(huellaDeLectura(resultado())).toBe(huellaDeLectura(resultado()));
    expect(huellaDeLectura(resultado())).toMatch(/^[0-9a-f]{8}$/);
  });

  it("CAMBIAR EL COSTO la cambia — que es el dato que no puede colarse sin verse", () => {
    const a = huellaDeLectura(resultado({ productos: [producto({ cost: 1.5 })] }));
    const b = huellaDeLectura(resultado({ productos: [producto({ cost: 1.51 })] }));
    expect(a).not.toBe(b);
  });

  it("y la cambian el código, el precio, una sugerencia y un aviso", () => {
    const base = huellaDeLectura(resultado());
    expect(huellaDeLectura(resultado({ productos: [producto({ code: "X2" })] }))).not.toBe(base);
    expect(huellaDeLectura(resultado({ productos: [producto({ price: 9 })] }))).not.toBe(base);
    expect(huellaDeLectura(resultado({ sugerencias: [{ code: "X1", groupCode: "G1" }] }))).not.toBe(base);
    expect(huellaDeLectura(resultado({
      avisos: [{ tipo: "fila-sin-codigo", hoja: "TODO", fila: 9, detalle: "x" }],
    }))).not.toBe(base);
  });

  it("un libro vacío tiene huella, y no es la de uno con un producto", () => {
    const vacio = huellaDeLectura({ productos: [], sugerencias: [], avisos: [] });
    expect(vacio).toMatch(/^[0-9a-f]{8}$/);
    expect(vacio).not.toBe(huellaDeLectura(resultado()));
  });
});

// ===========================================================================
describe("los grupos que salen de Ajustes", () => {
  const tienda = (name: string, promo_group?: string) => ({ name, address: "", promo_group });

  it("recorta, salta los vacíos y conserva el orden", () => {
    expect(gruposDeAjustes([tienda("A", " G1 "), tienda("B"), tienda("C", ""), tienda("D", "G2")]))
      .toEqual(["G1", "G2"]);
  });

  it("dos tiendas del mismo grupo dan UN grupo — que es lo que significa decidir juntas", () => {
    expect(gruposDeAjustes([tienda("A", "G1"), tienda("B", "G1")])).toEqual(["G1"]);
  });

  it("y no lo duplica por una mayúscula: el cruce con el nombre de hoja tampoco distingue", () => {
    expect(gruposDeAjustes([tienda("A", "g1"), tienda("B", "G1")])).toEqual(["g1"]);
  });

  it("sin tiendas, o sin ninguna cruzada, es vacío — y eso es legítimo, no un error", () => {
    expect(gruposDeAjustes(null)).toEqual([]);
    expect(gruposDeAjustes([tienda("A"), tienda("B")])).toEqual([]);
  });
});

// ===========================================================================
describe("la etiqueta de la ronda", () => {
  it("la que escribe el admin manda", () => {
    expect(etiquetaDeRonda("  9.25.26 Promo ", "otro.xlsx")).toBe("9.25.26 Promo");
  });
  it("vacía: el nombre del fichero sin extensión", () => {
    expect(etiquetaDeRonda("", "9.25.26 Promo (1).xlsx")).toBe("9.25.26 Promo (1)");
    expect(etiquetaDeRonda(null, "sin-extension")).toBe("sin-extension");
  });
  it("se recorta al tope de la base, no al revés", () => {
    expect(etiquetaDeRonda("x".repeat(500), null)).toHaveLength(LIMITES.largoDeEtiqueta);
  });
});

// ===========================================================================
describe("lo que se rechaza antes de escribir nada", () => {
  it("sin fichero", () => {
    expect(problemaDelFichero(null, 10)?.codigo).toBe("FICHERO_FALTA");
    expect(problemaDelFichero("a.xlsx", 0)?.codigo).toBe("FICHERO_FALTA");
  });

  it("un fichero por encima del tope, y el tope es el que dice LIMITES", () => {
    expect(problemaDelFichero("a.xlsx", LIMITES.bytesDelFichero)).toBeNull();
    expect(problemaDelFichero("a.xlsx", LIMITES.bytesDelFichero + 1)?.codigo).toBe("FICHERO_GRANDE");
  });

  it("un libro del que no se pudo leer ningún producto", () => {
    expect(problemaDeLoLeido({ productos: [], sugerencias: [], avisos: [] }, "R")?.codigo).toBe("SIN_PRODUCTOS");
  });

  it("los tres topes que COPIAN restricciones de la 140, en su frontera exacta", () => {
    // Un código de 81 o un grupo de 41 reventarían el `insert` entero y la ronda quedaría a
    // medias; el error de Postgres no diría cuál es la fila mala y este sí.
    const justo = producto({ code: "c".repeat(LIMITES.largoDeCodigo) });
    const pasado = producto({ code: "c".repeat(LIMITES.largoDeCodigo + 1) });
    expect(problemaDeLoLeido(resultado({ productos: [justo] }), "R")).toBeNull();
    expect(problemaDeLoLeido(resultado({ productos: [pasado] }), "R")?.codigo).toBe("CODIGO_LARGO");

    const gJusto = { code: "X1", groupCode: "g".repeat(LIMITES.largoDeGrupo) };
    const gPasado = { code: "X1", groupCode: "g".repeat(LIMITES.largoDeGrupo + 1) };
    expect(problemaDeLoLeido(resultado({ sugerencias: [gJusto] }), "R")).toBeNull();
    expect(problemaDeLoLeido(resultado({ sugerencias: [gPasado] }), "R")?.codigo).toBe("GRUPO_LARGO");

    expect(problemaDeLoLeido(resultado(), "")?.codigo).toBe("ETIQUETA");
    expect(problemaDeLoLeido(resultado(), "e".repeat(LIMITES.largoDeEtiqueta + 1))?.codigo).toBe("ETIQUETA");
  });

  it("y los topes del código son de verdad los de la migración, no un número parecido", () => {
    // Leído del `.sql`, no copiado a mano: si alguien cambia la restricción y no el límite, esto
    // cae. Se cita la CLÁUSULA ENTERA porque «between 1 and 40» es subcadena de «between 1 and 400».
    const sql = leer("supabase/migrations/140_promos.sql");
    expect(sql).toContain(`check (length(trim(label)) between 1 and ${LIMITES.largoDeEtiqueta})`);
    expect(sql).toContain(`check (length(trim(code)) between 1 and ${LIMITES.largoDeCodigo})`);
    expect(sql).toContain(`check (length(trim(group_code)) between 1 and ${LIMITES.largoDeGrupo})`);
  });

  it("un libro con más productos que el tope", () => {
    const muchos = Array.from({ length: LIMITES.productosPorRonda + 1 }, (_, i) => producto({ code: `C${i}` }));
    expect(problemaDeLoLeido(resultado({ productos: muchos }), "R")?.codigo).toBe("DEMASIADOS_PRODUCTOS");
  });
});

// ===========================================================================
describe("las filas que acaban en producción", () => {
  const { productos, sugerencias } = filasParaGuardar("RONDA-1", resultado({
    productos: [producto({ code: "ZZZ 3.5GAL", cost: null, price: null, diff: null })],
    sugerencias: [{ code: "ZZZ 3.5GAL", groupCode: "G1" }],
  }));

  it("traduce camelCase a las columnas de la tabla, y no pierde ningún campo", () => {
    expect(productos[0]).toEqual({
      round_id: "RONDA-1",
      code: "ZZZ 3.5GAL",
      supplier: "PROV", size: "8X48", description: "DESCRIPCION", notes: null,
      demand: 10, months_of_stock: 5, cost: null, diff: null,
      qoh: 100, qoh_by_store: { AA1: 1, BB2: 2 }, price: null,
      source_sheet: "TODO", row_no: 3,
    });
    expect(sugerencias).toEqual([{ round_id: "RONDA-1", code: "ZZZ 3.5GAL", group_code: "G1" }]);
  });

  it("un costo ausente se escribe como NULO, no como cero", () => {
    // Es la mitad de abajo del mismo fallo que caza `numero()`: leerlo bien y escribirlo como 0
    // daría el mismo margen inventado.
    expect(productos[0].cost).toBeNull();
    expect(productos[0].price).toBeNull();
    expect(productos[0].cost).not.toBe(0);
  });

  it("y las claves son EXACTAMENTE las columnas que declara la migración 140", () => {
    // Una columna de más o un nombre mal escrito no lo dice `tsc`: lo diría PostgREST al insertar,
    // en producción y con media ronda dentro. Se lee del `.sql`.
    const sql = leer("supabase/migrations/140_promos.sql");
    const bloque = sql.slice(
      sql.indexOf("create table if not exists public.promo_products ("),
      sql.indexOf("create table if not exists public.promo_suggestions ("),
    );
    expect(bloque.length).toBeGreaterThan(0);
    const columnas = new Set<string>();
    for (const linea of bloque.split("\n")) {
      // Por el TIPO y no por «dos espacios después del nombre»: `months_of_stock numeric,` lleva
      // uno solo y la primera versión de este extractor se lo dejaba fuera, con lo que la
      // comparación de abajo pasaba sin mirarlo. Y por el tipo tampoco cuelan `primary key (…)`
      // ni las líneas de `constraint`.
      const m = /^\s{2}([a-z_]+)\s+(uuid|text|numeric|integer|jsonb|timestamptz|boolean)\b/.exec(linea);
      if (m) columnas.add(m[1]);
    }
    // Control: si el extractor dejara de encontrar columnas, las comparaciones de abajo pasarían
    // solas. Se afirma que encontró las que se saben a mano.
    expect(columnas.has("cost")).toBe(true);
    expect(columnas.has("qoh_by_store")).toBe(true);
    expect(columnas.size).toBeGreaterThan(10);
    for (const clave of Object.keys(productos[0])) expect(columnas, clave).toContain(clave);
    expect(Object.keys(productos[0]).length).toBe(columnas.size);
  });
});

// ===========================================================================
describe("lo que `preview` manda al navegador", () => {
  const r = resumenParaPantalla(resultado({
    productos: [producto({ cost: 7.77, notes: "SECRETO", demand: 42, monthsOfStock: 13, diff: 3.3 })],
    sugerencias: [{ code: "X1", groupCode: "G1" }],
  }));

  it("NINGUNA de las cinco columnas privadas viaja, ni siquiera para el admin que sube", () => {
    const texto = JSON.stringify(r);
    for (const prohibido of ["7.77", "SECRETO", "42", "13", "3.3"]) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
    for (const clave of ["cost", "notes", "demand", "monthsOfStock", "diff"]) {
      expect(Object.keys(r.muestra[0]), clave).not.toContain(clave);
    }
  });

  it("y sí va lo que hace falta para comprobar que el libro se leyó bien", () => {
    expect(r.muestra[0]).toEqual({ code: "X1", description: "DESCRIPCION", price: 2.5, qoh: 100, sourceSheet: "TODO", rowNo: 3 });
    expect([r.productos, r.sugerencias]).toEqual([1, 1]);
    expect(r.gruposConSugerencias).toEqual(["G1"]);
  });
});

// ===========================================================================
describe("las dos rutas: quién escribe y quién no", () => {
  const preview = sinComentarios(leer("src/app/api/promos/preview/route.ts"));
  const commit = sinComentarios(leer("src/app/api/promos/commit/route.ts"));
  const lector = sinComentarios(leer("src/lib/promos/lectura-servidor.ts"));

  it("`preview` NO conoce la llave de servicio, ni por el lector que comparte", () => {
    // Es lo que la hace inofensiva en un preview de Vercel, que apunta a la misma base que
    // producción. Si esto deja de ser cierto, deja de serlo en silencio.
    for (const [nombre, src] of [["preview", preview], ["lector", lector]] as const) {
      expect(src, nombre).not.toContain("createAdminClient");
      expect(src, nombre).not.toContain("supabase/admin");
      expect(src, nombre).not.toContain(".insert(");
      expect(src, nombre).not.toContain(".update(");
      expect(src, nombre).not.toContain(".delete(");
    }
  });

  it("`commit` comprueba quién llama ANTES de coger la llave de servicio", () => {
    const iLee = commit.indexOf("await leeLaSubida(req)");
    const iLlave = commit.indexOf("createAdminClient()");
    // Primero que los dos existen: `indexOf` devuelve −1 si no está, y −1 < n pasaría la
    // comparación de orden sin que ninguna de las dos cosas estuviera en el fichero.
    expect(iLee).toBeGreaterThan(-1);
    expect(iLlave).toBeGreaterThan(-1);
    expect(iLee).toBeLessThan(iLlave);
  });

  it("y compara la huella antes de escribir", () => {
    const iHuella = commit.indexOf("if (huellaDelCliente !== huella)");
    const iLlave = commit.indexOf("createAdminClient()");
    expect(iHuella).toBeGreaterThan(-1);
    expect(iLlave).toBeGreaterThan(-1);
    expect(iHuella).toBeLessThan(iLlave);
  });

  it("el rol se comprueba en el SERVIDOR, no se confía en la pantalla", () => {
    expect(lector).toContain('if (me?.role !== "admin") {');
  });

  it("`commit` no acepta filas del navegador: las compone de lo que el servidor leyó", () => {
    // Si el cliente pudiera mandar las filas, podría mandar el costo que quisiera, y la 140 se
    // pasó una migración entera cerrando ese dato por privilegio de columna.
    expect(commit).toContain("filasParaGuardar(ronda.id as string, resultado)");
    expect(commit).not.toMatch(/form\.get\("productos"\)|body\.productos/);
  });

  it("si falla a mitad, borra la ronda — y la cascada se lleva lo demás", () => {
    expect(commit.match(/await admin\.from\("promo_rounds"\)\.delete\(\)\.eq\("id", ronda\.id\);/g) ?? [])
      .toHaveLength(2);
  });
});

// ===========================================================================
describe("la puerta que no se puede dejar abierta: nunca `select(\"*\")` sobre promo_products", () => {
  // Las cinco columnas privadas están REVOCADAS, así que un `select("*")` falla para todo el mundo
  // —manager incluido— y se lee como una avería. La regla es de FORMA, no de un sitio, así que se
  // recorre el árbol y se exige cero en vez de listar ficheros.
  const sospechoso = (texto: string) => {
    const plano = texto.split(/\s+/).join(" ");
    const hits: string[] = [];
    const re = /promo_products/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(plano)) !== null) {
      const ventana = plano.slice(m.index, m.index + 140);
      if (/\.select\(\s*['"`]\*['"`]\s*\)/.test(ventana)) hits.push(ventana.slice(0, 80));
    }
    return hits;
  };

  const ficheros: string[] = [];
  const recorre = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { recorre(p); continue; }
      if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) ficheros.push(p);
    }
  };
  recorre(join(process.cwd(), "src"));

  it("cero en todo `src`", () => {
    const malos = ficheros
      .map((f) => [f, sospechoso(readFileSync(f, "utf8"))] as const)
      .filter(([, h]) => h.length > 0);
    expect(malos.map(([f, h]) => `${f}: ${h.join(" | ")}`)).toEqual([]);
  });

  it("y el detector ve uno de verdad — si no, el cero de arriba no significaría nada", () => {
    expect(sospechoso('supabase.from("promo_products").select("*")')).toHaveLength(1);
    // También repartido en varias líneas, que es como se escribe de verdad.
    expect(sospechoso('supabase\n  .from("promo_products")\n  .select("*")\n  .eq("round_id", r)')).toHaveLength(1);
    // Y no se pone nervioso con lo que sí vale.
    expect(sospechoso('supabase.from("promo_products").select("code, price")')).toHaveLength(0);
    expect(sospechoso('supabase.from("promo_catalog").select("*")')).toHaveLength(0);
  });
});
