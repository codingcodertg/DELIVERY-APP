import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ordenaFilas, filtraFilas } from "@/lib/orden-y-filtro";
import { prefsDeValor, valorDeColumnas } from "@/lib/user-prefs";
import {
  cambioEnBloque, clavesDeTiendaDe, columnasDePromos, columnasDePromosPorDefecto, COLUMNAS_FIJAS,
  COLOR_DE_ESTADO, columnasVisiblesDePromos, cuentaPorEstado, esDecisorDePromos, puedeVerPrivadasDePromos, filaDePromo, filasDePromo, grupoDeLaTienda, LARGO_DE_NOTA,
  motivoParaNoDecidir, puedeDecidir, ordenDeColumnasDePromos, mueveColumnaDePromos, COLUMNA_PRIMERA, filtraPorTienda, MINIMO_EN_LA_TIENDA,
  valorDeColumna, valorParaFiltrar, type DecisionDeGrupo, type ProductoDeCatalogo,
} from "./tabla";

/**
 * Los valores son inventados. Las **formas** están medidas: el costo llega de la base con toda su
 * precisión de coma flotante, y las existencias vienen por tienda con la clave del libro.
 */
/**
 * Quita los comentarios antes de mirar el codigo.
 *
 * Sin esto, una prueba que exige que algo NO este se pone roja porque MI PROPIO comentario lo
 * nombra — me ha pasado tres veces en este modulo. Una prueba que confunde la prosa con el codigo
 * es una que alguien acabara relajando para callarla. Misma forma que en `map-legend.test.ts`.
 */
const sinComentarios = (x: string) =>
  x.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(SALTO).map((l) => (/^\s*\/\//.test(l) ? "" : l.replace(/\s\/\/.*$/, ""))).join(SALTO);

/** El salto de linea, por su codigo: escribirlo como literal dentro de una cadena generada es
 *  justo lo que rompio esta prueba una vez. */
const SALTO = String.fromCharCode(10);

const producto = (extra: Partial<ProductoDeCatalogo> = {}): ProductoDeCatalogo => ({
  round_id: "R1", code: "X1", supplier: "PROV", size: "8X48", description: "UNO",
  qoh: 100, qoh_by_store: { AA1: 10, BB2: 20 }, price: 1.39,
  source_sheet: "TODO", row_no: 3,
  private: { notes: "NOTA", demand: 12.5, months_of_stock: 3.14159, cost: 2.3456789012345, diff: 0.9876543 },
  ...extra,
});

const decision = (extra: Partial<DecisionDeGrupo> = {}): DecisionDeGrupo =>
  ({ round_id: "R1", code: "X1", group_code: "G1", status: "approved", note: null, ...extra });

// ===========================================================================
describe("las columnas de tienda salen del DATO, no del código", () => {
  it("se recorren TODOS los productos: una fila a la que le falte una tienda no se lleva su columna", () => {
    const claves = clavesDeTiendaDe([
      producto({ qoh_by_store: { AA1: 1 } }),
      producto({ code: "X2", qoh_by_store: { AA1: 1, BB2: 2 } }),
      producto({ code: "X3", qoh_by_store: null }),
    ]);
    expect(claves).toEqual(["AA1", "BB2"]);
  });

  it("dos tiendas que DECIDEN JUNTAS salen como dos columnas", () => {
    // Son existencias de dos almacenes distintos: juntarlas escondería que una tiene el material y
    // la otra no, y eso es justo lo que se mira para decidir si algo entra en promoción.
    const cols = columnasDePromos(clavesDeTiendaDe([producto({ qoh_by_store: { GEM1: 5, GEM2: 0 } })]), false);
    expect(cols.filter((c) => c.tienda).map((c) => [c.key, c.tienda])).toEqual([["qoh_GEM1", "GEM1"], ["qoh_GEM2", "GEM2"]]);
  });

  it("ninguna clave de tienda está escrita en el módulo", () => {
    const fuente = readFileSync(join(process.cwd(), "src/lib/promos/tabla.ts"), "utf8");
    // Las del libro real. Si alguna apareciera aquí, la tabla dejaría de servir para el libro del
    // mes que viene y además metería datos del dueño en el repositorio.
    for (const codigo of ["BRO", "WES", "PHR", "MCA", "MIS", "EDG", "MCAMIS"]) {
      expect(fuente, codigo).not.toMatch(new RegExp(`["'\`]${codigo}["'\`]`));
    }
  });
});

// ===========================================================================
describe("qué columnas se ofrecen", () => {
  it("las cinco privadas NO existen para quien no puede verlas — ni apagadas", () => {
    const sin = columnasDePromos(["AA1"], false).map((c) => c.key);
    const con = columnasDePromos(["AA1"], true).map((c) => c.key);
    for (const k of ["cost", "diff", "demand", "mo", "notes"]) {
      expect(sin, k).not.toContain(k);
      expect(con, k).toContain(k);
    }
    // Y lo que sí ve todo el mundo sigue estando.
    for (const k of ["code", "description", "qoh", "qoh_AA1", "price", "estado", "nota"]) expect(sin, k).toContain(k);
  });

  it("las fijas están, y son las que hacen falta para decidir", () => {
    const claves = columnasDePromos(["AA1"], true).map((c) => c.key);
    for (const k of COLUMNAS_FIJAS) expect(claves, k).toContain(k);
    expect([...COLUMNAS_FIJAS]).toEqual(["code", "estado"]);
    // D-381: la nota se puede quitar. Sigue en el arranque, pero no es fija.
    expect(COLUMNAS_FIJAS).not.toContain("nota");
  });

  it("por defecto entran las SEIS de tienda, y las privadas siguen fuera", () => {
    // ESTO CAMBIA EN PARTE LA DECISION DE ANTES, y conviene que se lea entera. La primera version
    // ofrecia las diecisiete y el dueno dijo «it's horrible, first it doesn't fit in 1 screen», asi
    // que el arranque se dejo en siete. El 2026-09-23 pidio lo contrario para una parte: «pon el
    // inventario de todas las tiendas para vista de todos». Lo que cambia es el juicio sobre las de
    // tienda —saber quien tiene el material es parte de decidir—, no la razon de que estorben.
    // Las cinco PRIVADAS no vuelven al arranque: eso sigue como estaba.
    const porDefecto = columnasDePromosPorDefecto(["AA1", "BB2", "CC3"], true);
    expect(porDefecto).toEqual(["code", "description", "size", "qoh", "qoh_AA1", "qoh_BB2", "qoh_CC3", "price", "estado", "nota"]);
    for (const privada of ["cost", "diff", "demand", "mo", "notes"]) expect(porDefecto, privada).not.toContain(privada);
    // Lo que queda fuera del arranque, dicho por nombre y no por una resta: las cinco privadas y
    // «Proveedor». Siguen existiendo en ⚙ Columnas, que es lo que las hace una eleccion.
    const todas = columnasDePromos(["AA1", "BB2", "CC3"], true).map((c) => c.key);
    expect(todas.filter((k) => !porDefecto.includes(k))).toEqual(["supplier", "cost", "diff", "demand", "mo", "notes"]);
  });

  it("un vendedor las ve igual: el inventario por tienda no es privado", () => {
    // «para vista de todos», literal. Lo unico que separa a un vendedor de un gerente aqui son las
    // cinco privadas, que decide la BASE (`private` llego nulo o no), no esta funcion.
    const deVentas = columnasDePromosPorDefecto(["AA1", "BB2", "CC3"], false);
    const deGerente = columnasDePromosPorDefecto(["AA1", "BB2", "CC3"], true);
    expect(deVentas).toEqual(deGerente);
    expect(deVentas.filter((k) => k.startsWith("qoh_"))).toEqual(["qoh_AA1", "qoh_BB2", "qoh_CC3"]);
  });

  it("y ya NO caben en 1280: la caja se desplaza, la pagina no", () => {
    // El numero se mueve y hay que decirlo: con seis tiendas el arranque pasa de 974 px a 1358.
    // La regla no es «que quepa», que con un libro de diez tiendas seria imposible: es la de
    // Ordenes —la PAGINA nunca se desplaza de lado y la caja de la tabla si—, y eso se mide en el
    // navegador, no aqui. Lo que esta prueba sostiene es lo que si es una cuenta: que estas seis
    // sean las columnas ESTRECHAS de la tabla, y que apagarlas devuelva el arranque de antes.
    const seis = ["AA1", "BB2", "CC3", "DD4", "EE5", "FF6"];
    const cols = columnasDePromos(seis, true);
    const ancho = (claves: readonly string[]) => claves.reduce((n, k) => n + cols.find((c) => c.key === k)!.ancho, 0);
    const porDefecto = columnasDePromosPorDefecto(seis, true);
    const deTienda = porDefecto.filter((k) => k.startsWith("qoh_"));
    expect(deTienda.length).toBe(6);
    for (const k of deTienda) expect(cols.find((c) => c.key === k)!.ancho, k).toBeLessThanOrEqual(64);
    expect(ancho(porDefecto)).toBe(1358);
    // Apagarlas en ⚙ Columnas deja exactamente lo de antes, que cabia a 1280.
    expect(ancho(porDefecto.filter((k) => !k.startsWith("qoh_")))).toBe(974);
    expect(1358 - 974).toBe(384);                       // lo que se ensancha: 384 px, no «unos 450»
  });

  it("lo guardado manda, pero las fijas entran siempre y lo que ya no existe se cae", () => {
    const cols = columnasDePromos(["AA1"], false);
    // Sin el código no se sabe qué fila es; sin el estado la tabla no sirve para lo que se entra
    // aquí. Una lista guardada antes de que fueran fijas dejaría una pantalla inútil. La nota ya no
    // es fija (D-381): quien la quitó, no la ve.
    expect(columnasVisiblesDePromos(["price"], cols)).toEqual(["code", "price", "estado"]);
    // Una columna de tienda que el libro de este mes ya no trae: fuera, sin romper nada.
    expect(columnasVisiblesDePromos(["code", "qoh_YA_NO", "price"], cols)).toEqual(["code", "price", "estado"]);
    // Y quien la marcó, la ve.
    expect(columnasVisiblesDePromos(["price", "nota"], cols)).toEqual(["code", "price", "estado", "nota"]);
    // Y el orden de la lista de visibles NO cuenta: sale en el que se marcaron. Sin orden guardado,
    // el del catálogo (el orden va aparte desde D-NEXT, como en Órdenes).
    expect(columnasVisiblesDePromos(["nota", "price", "code", "estado", "description"], cols))
      .toEqual(["code", "description", "price", "estado", "nota"]);
    // Sin nada guardado, el defecto.
    expect(columnasVisiblesDePromos(null, cols)).toEqual(columnasDePromosPorDefecto(["AA1"], false));
  });
});

// ===========================================================================
describe("la fila que se pinta", () => {
  it("el dinero se REDONDEA: el costo llega con toda su precisión y así no le sirve a nadie", () => {
    const f = filaDePromo(producto(), undefined);
    expect(f.cost).toBe(2.35);
    expect(f.diff).toBe(0.99);
    expect(f.price).toBe(1.39);
    // Y lo que NO es dinero no se toca: los meses de stock y la demanda son otra cosa.
    expect(f.mo).toBe(3.14159);
    expect(f.demand).toBe(12.5);
  });

  it("sin permiso para las cinco, llegan en ausente y no en cero", () => {
    const f = filaDePromo(producto({ private: null }), undefined);
    expect([f.cost, f.diff, f.demand, f.mo, f.notes]).toEqual([null, null, null, null, null]);
    expect(f.cost).not.toBe(0);
  });

  it("sin decisión, pendiente", () => {
    expect(filaDePromo(producto(), undefined).estado).toBe("pending");
  });

  it("solo se casa la decisión de MI grupo", () => {
    const productos = [producto(), producto({ code: "X2" })];
    const decisiones = [decision(), decision({ code: "X2", group_code: "OTRO", status: "rejected" })];
    const mias = filasDePromo(productos, decisiones, "G1");
    expect(mias.map((f) => [f.code, f.estado])).toEqual([["X1", "approved"], ["X2", "pending"]]);
  });

  it("sin grupo, TODO sale pendiente — no se coge la decisión de un grupo cualquiera", () => {
    const sinGrupo = filasDePromo([producto()], [decision()], null);
    expect(sinGrupo[0].estado).toBe("pending");
  });
});

// ===========================================================================
describe("ordenar y filtrar con lo de D-360", () => {
  const filas = [
    filaDePromo(producto({ code: "B", qoh: 5, qoh_by_store: { AA1: 9 } }), undefined),
    filaDePromo(producto({ code: "A", qoh: 50, qoh_by_store: { AA1: 1 } }), decision({ code: "A" })),
  ];

  it("una columna de tienda saca SU existencia", () => {
    expect(filas.map((f) => valorDeColumna(f, "qoh_AA1"))).toEqual([9, 1]);
    expect(valorDeColumna(filas[0], "qoh_NOEXISTE")).toBeNull();
  });

  it("el costo que se ordena es el REDONDEADO: se ordena por lo que se ve", () => {
    // Dos celdas que enseñan lo mismo tienen que empatar; si se ordenara por el valor crudo, la
    // pantalla enseñaría dos «2.35» colocados en un orden que no sabría explicar.
    const a = filaDePromo(producto({ code: "A", private: { notes: null, demand: null, months_of_stock: null, cost: 2.344999, diff: null } }), undefined);
    const b = filaDePromo(producto({ code: "B", private: { notes: null, demand: null, months_of_stock: null, cost: 2.345001, diff: null } }), undefined);
    expect([valorDeColumna(a, "cost"), valorDeColumna(b, "cost")]).toEqual([2.34, 2.35]);
  });

  it("ordena por número y por texto con las funciones que ya existen", () => {
    expect(ordenaFilas(filas, (f) => valorDeColumna(f, "qoh"), "asc").map((f) => f.code)).toEqual(["B", "A"]);
    expect(ordenaFilas(filas, (f) => valorDeColumna(f, "code"), "asc").map((f) => f.code)).toEqual(["A", "B"]);
  });

  it("filtra por estado como por cualquier otra columna", () => {
    // Con `valorParaFiltrar`, que es la misma función con los argumentos en el orden que pide
    // `filtraFilas`. Existe justo para que nadie los invierta sin darse cuenta.
    const soloAprobadas = filtraFilas(filas, { estado: new Set(["approved"]) }, valorParaFiltrar);
    expect(soloAprobadas.map((f) => f.code)).toEqual(["A"]);
  });

  it("y las dos formas de pedir el mismo valor coinciden", () => {
    for (const clave of ["code", "qoh", "qoh_AA1", "estado", "cost"]) {
      expect(valorParaFiltrar(clave, filas[0]), clave).toBe(valorDeColumna(filas[0], clave));
    }
  });

  it("y la cuenta por estado es la de los chips", () => {
    expect(cuentaPorEstado(filas)).toEqual({ pending: 1, approved: 1, rejected: 0 });
  });
});

// ===========================================================================
describe("el grupo de una tienda: el gemelo de `promo_group_of_user()`", () => {
  const tiendas = [{ name: " Uno ", promo_group: " G1 " }, { name: "Dos", promo_group: "" }, { name: "Tres" }];

  it("lo encuentra recortando y SIN distinguir mayúsculas, igual que la función de la base", () => {
    // Si los dos lados no compararan igual, la pantalla ofrecería el botón y la RLS rechazaría la
    // escritura con CERO FILAS — sin error, o sea en silencio.
    expect(grupoDeLaTienda(tiendas, "uno")).toBe("G1");
    expect(grupoDeLaTienda(tiendas, "  UNO  ")).toBe("G1");
  });

  it("nulo cuando no hay tienda, no existe, o no tiene grupo — que es el valor seguro", () => {
    expect(grupoDeLaTienda(tiendas, null)).toBeNull();
    expect(grupoDeLaTienda(tiendas, "  ")).toBeNull();
    expect(grupoDeLaTienda(tiendas, "no existe")).toBeNull();
    expect(grupoDeLaTienda(tiendas, "Dos")).toBeNull();
    expect(grupoDeLaTienda(tiendas, "Tres")).toBeNull();
    expect(grupoDeLaTienda(null, "Uno")).toBeNull();
  });

  it("y la base compara igual: `lower(trim(...))` en los dos lados", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/140_promos.sql"), "utf8");
    expect(sql).toContain("lower(trim(s->>'name')) = lower(trim((select store from public.profiles where id = auth.uid())))");
    expect(sql).toContain("select nullif(trim(s->>'promo_group'), '')");
  });
});

// ===========================================================================
describe("quién es decisor: el gemelo de `promo_is_decider()`", () => {
  it("el admin, en cualquier grupo, y aunque no tenga ninguno", () => {
    expect(esDecisorDePromos({ rol: "admin", grupo: null })).toBe(true);
    expect(esDecisorDePromos({ rol: "admin", grupo: "G1" })).toBe(true);
  });

  it("gerente de oficina y oficina, SOLO con grupo", () => {
    for (const rol of ["manager", "accounting"]) {
      expect(esDecisorDePromos({ rol, grupo: "G1" }), rol).toBe(true);
      expect(esDecisorDePromos({ rol, grupo: null }), rol).toBe(false);
    }
  });

  it("nadie más, tenga grupo o no", () => {
    for (const rol of ["sales", "driver", "warehouse", "logistics", null, undefined, "Admin"]) {
      expect(esDecisorDePromos({ rol, grupo: "G1" }), String(rol)).toBe(false);
    }
  });

  it("y la base dice los mismos dos roles", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/140_promos.sql"), "utf8");
    expect(sql).toContain("public.current_user_role() in ('manager', 'accounting')");
  });
});

// ===========================================================================
describe("quién puede decidir, y por qué no", () => {
  const base = { esDecisor: true, grupo: "G1" as string | null, rondaCerrada: false };

  it("decisor, con grupo y ronda abierta", () => {
    expect(puedeDecidir(base)).toBe(true);
    expect(motivoParaNoDecidir(base)).toBeNull();
  });

  it("la ronda cerrada manda sobre lo demás, y se dice que se puede reabrir", () => {
    // Es la primera razón que se mira a propósito: si además falta el grupo, lo que hay que
    // arreglar primero es la ronda.
    expect(puedeDecidir({ ...base, rondaCerrada: true })).toBe(false);
    expect(motivoParaNoDecidir({ ...base, rondaCerrada: true })!.es).toMatch(/cerrada/);
    expect(motivoParaNoDecidir({ esDecisor: false, grupo: null, rondaCerrada: true })!.es).toMatch(/cerrada/);
  });

  it("un vendedor no decide, y se le dice quién", () => {
    expect(puedeDecidir({ ...base, esDecisor: false })).toBe(false);
    expect(motivoParaNoDecidir({ ...base, esDecisor: false })!.es).toMatch(/Gerente de Oficina/);
  });

  it("sin grupo no se decide, y se dice dónde se pone", () => {
    expect(puedeDecidir({ ...base, grupo: null })).toBe(false);
    expect(motivoParaNoDecidir({ ...base, grupo: null })!.es).toMatch(/Datos → Tiendas/);
  });
});

// ===========================================================================
describe("la tabla es LA DE ÓRDENES, no una que se le parece", () => {
  const tabla = readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8");
  const ordenes = readFileSync(join(process.cwd(), "src/components/OrdersTable.tsx"), "utf8");

  it("usa sus MISMAS clases, sacadas de `OrdersTable` y no escritas de memoria", () => {
    // El dueño pidió «the style of the order table in deliveries». Que la coherencia venga de usar
    // las mismas clases y no de copiar CSS: si algún día cambian ahí, cambian aquí.
    for (const clase of ["tbl-scroll tbl-fit orders-scroll", "orders tbl-resize orders-responsive"]) {
      expect(ordenes, clase).toContain(clase);
      expect(tabla, clase).toContain(clase);
    }
  });

  it("y sus mismas piezas: `colgroup` con anchos, asas de arrastre y `anchoDeTabla`", () => {
    expect(tabla).toContain("<colgroup>");
    expect(tabla).toContain("useColWidthMap(");
    expect(tabla).toContain("anchoDeTabla([");
    expect(tabla).toContain('className="col-resizer"');
    expect(tabla).toContain("anchos.startResize(c.key)");
  });

  it("cada celda lleva su `data-label`, que es lo que la vuelve tarjeta en el teléfono", () => {
    // Sin él, `orders-responsive` pinta las tarjetas sin rótulo y no se sabe qué es cada valor.
    expect(tabla).toContain("data-label={lang === \"es\" ? c.es : c.en}");
  });

  it("NO se le pone alto propio: la de Órdenes tampoco lo tiene", () => {
    // Medido en producción a 1280 y 1440: la de Órdenes no tiene desplazamiento vertical propio
    // —quien baja es la página— y lo que da la sensación de «cabe en una pantalla» es que la caja
    // no se salga de LADO más la cabecera pegada. Ponerle alto sería hacer más que la referencia.
    // Se mira la CAJA de la tabla, no el fichero entero: el menú de ⚙ Columnas sí lleva su
    // `maxHeight`, y prohibirlo en todo el fichero habría sido una prueba que no dice lo que cree.
    const caja = tabla.split(SALTO).filter((l) => l.includes("tbl-scroll"));
    expect(caja).toHaveLength(1);
    expect(caja[0]).not.toMatch(/style=|maxHeight|promos-alto/);
    expect(tabla).not.toContain("promos-alto");
    // Y la referencia tampoco lo tiene, que es de donde sale la regla.
    expect(ordenes.split(SALTO).filter((l) => l.includes("tbl-scroll"))[0]).not.toMatch(/maxHeight|style=/);
  });
});

// ===========================================================================
describe("las cuatro diferencias que se veian al lado de Ordenes", () => {
  const tabla = readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8");
  const ordenes = readFileSync(join(process.cwd(), "src/components/OrdersTable.tsx"), "utf8");

  it("el estado es una PASTILLA con las clases de Órdenes, no texto plano", () => {
    // Era la diferencia más visible al poner las dos tablas al lado.
    // La expresion ENTERA de la celda, no `className="sema"` a secas: eso lo cumple tambien la
    // pastilla de «Cerrada» de la cabecera, y con ella la prueba pasaba con el estado en texto
    // plano. Lo enseño un mutante que sobrevivio.
    expect(tabla).toContain('<span className="sema" title={texto} style={{ background: COLOR_DE_ESTADO[fila.estado], color: "#fff" }}>{texto}</span>');
    expect(tabla).toContain('className={c.key === "estado" ? "td-pastillas" : undefined}');
    // Y las mismas dos clases están en Órdenes: la coherencia viene de usarlas, no de copiarlas.
    expect(ordenes).toContain('className="sema"');
    expect(ordenes).toContain("td-pastillas");
  });

  it("y su color sale de la paleta de las etapas, no de un hex escrito aquí", () => {
    const fuente = readFileSync(join(process.cwd(), "src/lib/promos/tabla.ts"), "utf8");
    expect(fuente).toContain('pending: stageInfo("pending").color');
    expect(fuente).toContain('approved: stageInfo("delivered").color');
    expect(fuente).toContain('rejected: stageInfo("rejected").color');
    // Ni un color a mano en el módulo: si alguien retoca la paleta, se retoca aquí también.
    expect(sinComentarios(fuente)).not.toMatch(/#[0-9a-fA-F]{6}/);
    // Y los tres son distintos: un estado que se pinta igual que otro no dice nada.
    expect(new Set(Object.values(COLOR_DE_ESTADO)).size).toBe(3);
  });

  it("el selector de columnas es el «⚙ Columnas» de Órdenes, no un `details` nativo", () => {
    expect(tabla).toContain('<button className="btn btn-ghost" onClick={() => setShowCols((v) => !v)}>⚙ ');
    expect(tabla).toContain('<div className="col-menu">');
    expect(tabla).toContain('className="col-opt"');
    expect(sinComentarios(tabla)).not.toContain("<details>");
    // Y se cierra igual: clic fuera o Escape (D-275).
    expect(tabla).toContain("useCierraAlSalir(showCols");
  });

  it("las celdas que se cortan llevan su texto entero en `title`", () => {
    // La descripción es el NOMBRE del producto que hay que reconocer para decidir; recortada y sin
    // `title` no hay forma de leerla salvo ensanchando la columna.
    expect(tabla).toContain('title={c.key === "estado" ? undefined : textoDeCelda(f, c.key)}');
  });
});

// ===========================================================================
describe("el demo respeta «Ver como»", () => {
  const demo = readFileSync(join(process.cwd(), "src/app/promos/[id]/RondaDemo.tsx"), "utf8");
  const pagina = readFileSync(join(process.cwd(), "src/app/promos/[id]/page.tsx"), "utf8");

  it("el rol sale de «Ver como» y no está clavado en admin", () => {
    // Con `rol="admin"` clavado no había forma de medir las dos vistas que más importan: qué ve y
    // qué no ve un vendedor, y qué puede hacer un gerente.
    expect(sinComentarios(pagina)).not.toMatch(/rol="admin"/);
    expect(demo).toContain("localStorage.getItem(ME_DEMO)");
    // Y que lo LEIDO es lo que se usa: con solo la lectura, un `setRol("admin")` a secas pasaba.
    expect(demo).toContain('setRol(typeof me?.role === "string" ? me.role : "admin");');
    expect(demo).toContain('const ME_DEMO = "rtg_deliveries_local_me";');
  });

  it("y quien no puede ver las cinco privadas NO las recibe, ni en demo", () => {
    // En la app de verdad esto se deduce del dato; en demo no hay base que lo decida, así que el
    // demo lo simula. Sin esto enseñaría el costo a un vendedor de mentira.
    expect(demo).toContain("puedeVerPrivadas ? p : { ...p, private: null }");
  });

  it("pero quién DECIDE no se simula: sale de la misma función que usa la app", () => {
    expect(demo).toContain("esDecisor={esDecisorDePromos({ rol, grupo })}");
  });

  it("no pinta nada hasta saber el rol", () => {
    // Pintar como admin y cambiar medio segundo despues seria enseñar lo que no toca.
    expect(demo).toContain("if (rol === null) return null;");
  });
});

// ===========================================================================
describe("quién ve las cinco privadas: el gemelo para el demo", () => {
  it("admin, gerente de oficina y oficina; nadie más", () => {
    for (const rol of ["admin", "manager", "accounting"]) expect(puedeVerPrivadasDePromos(rol), rol).toBe(true);
    for (const rol of ["sales", "driver", "warehouse", "logistics", null, undefined]) {
      expect(puedeVerPrivadasDePromos(rol), String(rol)).toBe(false);
    }
  });

  it("y la base dice lo mismo", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/140_promos.sql"), "utf8");
    expect(sql).toContain("and (public.is_admin() or public.current_user_role() in ('manager', 'accounting'));");
  });
});

// ===========================================================================
describe("las columnas de cada persona se GUARDAN — la 141 tenía que servir para algo", () => {
  const tabla = readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8");

  it("se leen y se guardan con la clave de la 141", () => {
    // La primera versión las tenía en un `useState` y nada más: se elegían, se veían, y al
    // recargar volvían al defecto. La clave de la migración estaba declarada y no la usaba nadie,
    // así que la 141 se aplicó a producción para nada.
    expect(tabla).toContain("CLAVE_DE_COLUMNAS_DE_PROMOS");
    expect(tabla).toContain("leeColumnas(createClient() as unknown as ClienteDePrefs, userId, CLAVE_DE_COLUMNAS_DE_PROMOS)");
    // El escritor es uno solo (`escribeLaFila`), así que aquí se cita su cuerpo y no una llamada
    // suelta: la prueba de más abajo es la que exige que sea UNO.
    expect(tabla).toContain("createClient() as unknown as ClienteDePrefs, userId!, visiblesDeLaBase.current ?? {},");
  });

  it("y no se escribe a ciegas encima de lo que haya: solo si se pudo leer", () => {
    expect(tabla.match(/visiblesDeLaBase\.current === null\) return;/g) ?? []).toHaveLength(2);
  });

  it("y el navegador es la RED: al marcar se escribe en los dos sitios", () => {
    // Principio de D-330, que es lo que hace Órdenes: `user_prefs` manda —por persona, vale en
    // cualquier máquina— y el navegador guarda por si la base no contesta. Sin él, una lectura
    // fallida le borra a alguien su elección sin decir nada.
    expect(tabla).toContain("localStorage.setItem(claveDelNavegadorDePromos(rol), JSON.stringify(next))");
    expect(tabla).toContain("localStorage.getItem(claveDelNavegadorDePromos(rol))");
    // Con su try/catch a los dos lados: en una ventana privada `localStorage` puede lanzar.
    expect((tabla.match(/catch \{ \/\* sin memoria/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("y el navegador se escribe ANTES del corte que protege la base", () => {
    // Si se escribiera después del `return` que exige haber leído la base, una base que no
    // contesta dejaría también al navegador sin nada — que es justo el caso que la red cubre.
    const cuerpo = tabla.slice(tabla.indexOf("const ponColumnas"), tabla.indexOf("const ponVisibles"));
    const iNavegador = cuerpo.indexOf("localStorage.setItem");
    const iCorte = cuerpo.indexOf("visiblesDeLaBase.current === null) return;");
    expect(iNavegador).toBeGreaterThan(-1);
    expect(iCorte).toBeGreaterThan(-1);
    expect(iNavegador).toBeLessThan(iCorte);
  });

  it("los ANCHOS también son por persona, no por navegador", () => {
    // D-338: el dueño pidió «resize … and it saves for ever», y aquí «así como Excel, resize sus
    // columnas». Con los anchos solo en `localStorage`, ensanchar una columna en una máquina no se
    // veía en la otra — y el comentario de esta línea decía que sí. Es la misma llamada que Órdenes.
    expect(tabla).toContain("deLaPersona: anchosDelRol ?? undefined,");
    expect(tabla).toContain("alCambiar: guardaAnchos,");
    expect(tabla).toContain("minimo: ANCHO_MINIMO,");
  });

  it("UN SOLO escritor, y siempre manda las DOS mitades", () => {
    // La lección de D-338: `guardaColumnas` escribe la fila entera, así que guardar una mitad con
    // la otra a medio poner la borra. Marcar una columna borraría los anchos, y arrastrar un ancho
    // borraría las columnas. Se comprueba contando: UNA sola llamada, dentro de `escribeLaFila`.
    expect(tabla.match(/guardaColumnas\(/g) ?? []).toHaveLength(1);
    expect(tabla).toContain("visiblesDeLaBase.current ?? {},");
    // Y desde D-NEXT las TRES: el orden va con lo leído, no con un `{}` que lo borraría.
    expect(tabla).toContain("CLAVE_DE_COLUMNAS_DE_PROMOS, ordenDeLaBase.current, anchosDeLaBase.current,");
    // Y que los dos caminos pasen por él.
    expect(tabla.match(/void escribeLaFila\(\);/g) ?? []).toHaveLength(3);
  });

  it("la semilla del navegador NO corre si se está suplantando ni si no se sabe", () => {
    // Durante una suplantación la sesión es la del otro: sembrar le escribiría a esa persona los
    // anchos de este navegador. `hayQueSembrar` exige `suplantando === false`, no «no se sabe».
    expect(tabla).toContain("hayQueSembrar({ baseLeida: true, hayFila: false, suplantando }");
    expect(tabla).toContain('await (await fetch("/api/impersonate/state")).json()');
    expect(tabla).toContain("if (leido.hayFila) return;");
  });
});

// ===========================================================================
describe("lo que se escribe al decidir", () => {
  it("una fila por producto, con la clave primaria de la 140 y nada más", () => {
    const filas = cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1", "X2"], estado: "approved" });
    expect(filas).toEqual([
      { round_id: "R1", code: "X1", group_code: "G1", status: "approved" },
      { round_id: "R1", code: "X2", group_code: "G1", status: "approved" },
    ]);
  });

  it("NO manda `decided_by` ni `decided_at`: los pisa el disparador", () => {
    // Mandarlos sería escribir algo que va a ser ignorado y leerlo de vuelta como si fuera nuestro.
    const [fila] = cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1"], estado: "rejected" });
    expect(Object.keys(fila).sort()).toEqual(["code", "group_code", "round_id", "status"]);
  });

  it("SIN nota, la clave `note` NO VA — es lo que impide que aprobar en bloque borre las notas", () => {
    // `"note" in fila` y no `fila.note === undefined`: lo segundo pasaría igual con la clave
    // presente y vacía, que es justo el caso que hay que impedir.
    const filas = cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1", "X2"], estado: "approved" });
    for (const f of filas) expect("note" in f, f.code).toBe(false);
  });

  it("CON nota, la llevan todas", () => {
    const filas = cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1", "X2"], estado: "rejected", nota: "descontinuado" });
    for (const f of filas) expect(f.note, f.code).toBe("descontinuado");
    expect(filas.every((f) => "note" in f)).toBe(true);
  });

  it("y TODAS las filas de un lote llevan exactamente las mismas claves", () => {
    // Medido en la librería instalada (`@supabase/postgrest-js` 2.112.4, `dist/index.mjs:3236`):
    // las columnas del `upsert` son la UNIÓN de las claves de todas las filas, y con
    // `defaultToNull` —el defecto— las filas que no traen una columna del lote se escriben a
    // `null`. Un lote mezclado borraría la nota justo de las que no se pensaba tocar.
    for (const nota of [undefined, "x", null] as const) {
      const filas = cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1", "X2", "X3"], estado: "approved", ...(nota === undefined ? {} : { nota }) });
      const claves = filas.map((f) => Object.keys(f).sort().join(","));
      expect(new Set(claves).size, String(nota)).toBe(1);
    }
  });

  it("un código repetido en la selección se escribe una vez", () => {
    expect(cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1", "X1"], estado: "approved" })).toHaveLength(1);
  });

  it("una nota en blanco se guarda como NULA, no como cadena vacía", () => {
    expect(cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1"], estado: "approved", nota: "   " })[0].note).toBeNull();
    expect(cambioEnBloque({ roundId: "R1", grupo: "G1", codigos: ["X1"], estado: "approved", nota: " hola " })[0].note).toBe("hola");
  });

  it("y la PANTALLA solo manda la nota desde el recuadro de editarla", () => {
    // `cambioEnBloque` conserva la nota cuando no se la dan, pero eso no sirve de nada si la
    // pantalla se la da igual. Los botones de ✓/✕ de una fila reenviaban `f.nota`: además de
    // innecesario era una escritura perdida, porque pisaría la nota que otra persona hubiera
    // escrito mientras esta pantalla tenía la suya en memoria.
    const tabla = readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8");
    // Con el `}` del cierre de la expresión JSX: sin él, `guarda([f.code], "approved")` es
    // SUBCADENA de `guarda([f.code], "approved", f.nota)` y esta prueba pasaría con el fallo puesto.
    expect(tabla).toContain('onClick={() => guarda([f.code], "approved")}');
    expect(tabla).toContain('onClick={() => guarda([f.code], "rejected")}');
    // Y por el otro lado, que no quede ninguna llamada de fila con tercer argumento.
    expect(tabla).not.toMatch(/guarda\(\[f\.code\], "(approved|rejected)",/);
    // El único sitio donde la nota viaja: el recuadro de editarla, que manda el estado que ya tenía.
    expect(tabla).toContain("guarda([f.code], f.estado, notaEditando.texto)");
  });

  it("el tope de la nota es el de la migración, leído del `.sql`", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/140_promos.sql"), "utf8");
    // La cláusula entera: «length(note) <= 500» es subcadena de «<= 5000».
    expect(sql).toContain(`check (note is null or length(note) <= ${LARGO_DE_NOTA})`);
  });
});

// ===========================================================================
describe("el ORDEN de las columnas es de cada persona (D-NEXT)", () => {
  // El dueño: «Can you make it to where I can move the place of the columns in promos». Mismo
  // mecanismo que Órdenes (D-332): el orden va aparte de qué se ve, en `_orden` de la misma fila.
  const cols = columnasDePromos(["AA1", "BB2"], false);
  const catalogo = cols.map((c) => c.key);

  it("sin orden guardado, el del catálogo: nadie nota nada hasta que pulsa una flecha", () => {
    expect(ordenDeColumnasDePromos(cols, null)).toEqual(catalogo);
    expect(columnasVisiblesDePromos(null, cols, null)).toEqual(columnasVisiblesDePromos(null, cols));
  });

  it("el orden guardado manda en lo que se pinta", () => {
    const orden = ["code", "nota", "price", "estado", "description", "qoh_BB2", "qoh_AA1", "size", "qoh", "supplier"];
    expect(columnasVisiblesDePromos(["description", "price", "estado", "nota", "qoh_AA1"], cols, orden))
      .toEqual(["code", "nota", "price", "estado", "description", "qoh_AA1"]);
  });

  it("`code` va siempre primera, no se mueve, y nadie se le pone delante", () => {
    expect(COLUMNA_PRIMERA).toBe("code");
    // Aunque lo guardado la ponga en otro sitio.
    expect(ordenDeColumnasDePromos(cols, ["price", "estado", "code"])[0]).toBe("code");
    const orden = ordenDeColumnasDePromos(cols, null);
    expect(mueveColumnaDePromos(orden, "code", 1)).toEqual(orden);
    // La segunda no sube por encima de ella: pulsar ↑ no hace nada.
    expect(mueveColumnaDePromos(orden, orden[1], -1)).toEqual(orden);
  });

  it("las fijas se MUEVEN pero no se QUITAN", () => {
    const orden = ordenDeColumnasDePromos(cols, null);
    const movido = mueveColumnaDePromos(orden, "estado", -1);
    expect(movido.indexOf("estado")).toBe(orden.indexOf("estado") - 1);
    // Una lista guardada sin `estado` lo trae igual, en su sitio.
    expect(columnasVisiblesDePromos(["price"], cols, movido)).toEqual(movido.filter((k) => ["code", "price", "estado"].includes(k)));
  });

  it("una flecha mueve entre las VISIBLES, saltando las escondidas (la de Órdenes)", () => {
    const orden = ["code", "description", "supplier", "size", "estado"];
    const pocas = columnasDePromos([], false).filter((c) => orden.includes(c.key));
    expect(mueveColumnaDePromos(ordenDeColumnasDePromos(pocas, orden), "size", -1, ["code", "description", "size", "estado"]))
      .toEqual(["code", "size", "description", "supplier", "estado"]);
  });

  it("una tienda que el libro de este mes ya NO trae se cae del orden, sin romper nada", () => {
    const orden = ["code", "qoh_YA_NO", "price", ...catalogo];
    const r = ordenDeColumnasDePromos(cols, orden);
    expect(r).not.toContain("qoh_YA_NO");
    expect([...r].sort()).toEqual([...catalogo].sort());
    expect(r.slice(0, 2)).toEqual(["code", "price"]);
  });

  it("una tienda NUEVA entra detrás de su vecina: ni desaparece ni se va al final", () => {
    // Septiembre: solo había AA1, y esta persona la puso delante del todo.
    const deSeptiembre = ["code", "qoh_AA1", "nota", "estado", "description", "supplier", "size", "qoh", "price"];
    const r = ordenDeColumnasDePromos(cols, deSeptiembre);
    expect(r).toContain("qoh_BB2");
    expect(r.indexOf("qoh_BB2")).toBe(r.indexOf("qoh_AA1") + 1);
    // Y lo demás, como lo dejó.
    expect(r.filter((k) => k !== "qoh_BB2")).toEqual(deSeptiembre);
  });

  it("y sale VISIBLE para quien guardó sus columnas antes de que existiera", () => {
    const deSeptiembre = ordenDeColumnasDePromos(columnasDePromos(["AA1"], false), null);
    const visiblesDeSeptiembre = ["code", "description", "qoh_AA1", "estado"];
    expect(columnasVisiblesDePromos(visiblesDeSeptiembre, cols, deSeptiembre)).toContain("qoh_BB2");
  });

  it("pero una que CONOCÍA y escondió sigue escondida: eso sí lo decidió", () => {
    const conAmbas = ordenDeColumnasDePromos(cols, null);
    expect(columnasVisiblesDePromos(["code", "description", "qoh_AA1", "estado"], cols, conAmbas)).not.toContain("qoh_BB2");
    // Y una privada nueva para quien ahora puede verlas no entra sola: no son del arranque.
    const conPrivadas = columnasDePromos(["AA1", "BB2"], true);
    expect(columnasVisiblesDePromos(["code", "estado"], conPrivadas, conAmbas)).not.toContain("cost");
  });

  it("el orden viaja en la fila de `user_prefs` y vuelve igual (`_orden`, por rol)", () => {
    const orden = ordenDeColumnasDePromos(cols, ["code", "nota", "qoh_BB2"]);
    const valor = valorDeColumnas({ visibles: { manager: ["code", "estado"] }, orden: { manager: orden }, anchos: {} });
    expect(valor._orden).toEqual({ manager: orden });
    expect(prefsDeValor(valor).orden.manager).toEqual(orden);
  });
});

describe("la pantalla ordena con la función, y guarda el orden sin pisar nada (D-NEXT)", () => {
  const tabla = sinComentarios(readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8"));

  it("lo que se pinta sale de `columnasVisiblesDePromos` CON el orden de la persona", () => {
    expect(tabla).toContain("const visiblesEfectivas = columnasVisiblesDePromos(visibles, columnas, ordenDeColumnas);");
    expect(tabla).toContain("const columnasPintadas = visiblesEfectivas.map(");
    expect(tabla).toContain("const ordenDelSelector = ordenDeColumnasDePromos(columnas, ordenDeColumnas);");
  });

  it("⚙ Columnas lista en ese orden, con las flechas ↑ ↓ de Órdenes", () => {
    expect(tabla).toContain("{ordenDelSelector.map((k) => columnas.find((c) => c.key === k)!).map((c) => (");
    expect(tabla).toContain("guardaOrden(mueveColumnaDePromos(ordenDelSelector, c.key, -1, visiblesEfectivas))");
    expect(tabla).toContain("guardaOrden(mueveColumnaDePromos(ordenDelSelector, c.key, 1, visiblesEfectivas))");
  });

  it("el orden se LEE de la base y del navegador", () => {
    expect(tabla).toContain("ordenDeLaBase.current = leido.orden;");
    expect(tabla).toContain("const suOrden = leido.orden[rol as UserRole];");
    expect(tabla).toContain("localStorage.getItem(claveDelOrdenDePromos(rol))");
    // Y lo leído SE USA: leerlo y no ponerlo es lo mismo que no leerlo.
    expect(tabla).toContain("if (suOrden) setOrdenDeColumnas(suOrden);");
    expect(tabla).toContain('if (Array.isArray(lista)) setOrdenDeColumnas(lista.filter((k) => typeof k === "string"));');
  });

  it("y se GUARDA en los dos, con el navegador antes del corte y sin pisar los otros roles", () => {
    const cuerpo = tabla.slice(tabla.indexOf("const ponColumnas"), tabla.indexOf("const ponVisibles"));
    const iNavegador = cuerpo.indexOf("localStorage.setItem(claveDelOrdenDePromos(rol), JSON.stringify(nextOrden))");
    const iCorte = cuerpo.indexOf("visiblesDeLaBase.current === null) return;");
    expect(iNavegador).toBeGreaterThan(-1);
    expect(iNavegador).toBeLessThan(iCorte);
    // Se parte de lo LEÍDO y se cambia solo el rol propio: el resto de la fila va como vino.
    expect(cuerpo).toContain("ordenDeLaBase.current = { ...ordenDeLaBase.current, [rol as UserRole]: nextOrden };");
  });

  it("marcar una casilla guarda también el orden, que es lo que deja reconocer una tienda nueva", () => {
    expect(tabla).toContain("const ponVisibles = (next: string[]) => ponColumnas(next, ordenDelSelector);");
    expect(tabla).toContain("const guardaOrden = (nextOrden: string[]) => ponColumnas(visiblesEfectivas, nextOrden);");
  });
});

// ===========================================================================
describe("el filtro de tienda: fuera lo que tiene menos de 10 en ELLA (D-NEXT)", () => {
  // El dueño: «make the store filter work meaning if the item in existencia in the store has less
  // than 10 then that will not be included in the list».
  const conTienda = (code: string, qoh_by_store: Record<string, number | null>) => producto({ code, qoh_by_store });
  const filas = filasDePromo([
    conTienda("NUEVE", { AA1: 9, BB2: 500 }),
    conTienda("DIEZ", { AA1: 10, BB2: 0 }),
    conTienda("ONCE", { AA1: 11, BB2: 0 }),
    conTienda("NULO", { AA1: null, BB2: 500 }),
    conTienda("SIN_CLAVE", { BB2: 500 }),
  ], [], null);
  const claves = ["AA1", "BB2"];
  const codigos = (fs: readonly { code: string }[]) => fs.map((f) => f.code);

  it("el número es 10, y tiene nombre", () => {
    expect(MINIMO_EN_LA_TIENDA).toBe(10);
  });

  it("menos de 10 fuera; 10 JUSTO se queda", () => {
    expect(codigos(filtraPorTienda(filas, "AA1", claves))).toEqual(["DIEZ", "ONCE"]);
  });

  it("sin dato cuenta como 0, y queda fuera — nulo o sin la clave", () => {
    const r = codigos(filtraPorTienda(filas, "AA1", claves));
    expect(r).not.toContain("NULO");
    expect(r).not.toContain("SIN_CLAVE");
  });

  it("mira SOLO la tienda elegida: ni otra, ni el total", () => {
    // DIEZ y ONCE pasan en AA1 y tienen 0 en BB2; el total del producto de prueba es 100 en todos.
    // Con BB2 elegida quedan justo los que tienen 500 en ELLA.
    expect(codigos(filtraPorTienda(filas, "BB2", claves))).toEqual(["NUEVE", "NULO", "SIN_CLAVE"]);
  });

  it("sin tienda elegida, o con una que esta ronda no trae, no filtra nada", () => {
    expect(codigos(filtraPorTienda(filas, "", claves))).toEqual(codigos(filas));
    expect(codigos(filtraPorTienda(filas, null, claves))).toEqual(codigos(filas));
    expect(codigos(filtraPorTienda(filas, "YA_NO", claves))).toEqual(codigos(filas));
  });

  it("la pantalla filtra con la función, y ANTES de contar: los chips hablan de la lista filtrada", () => {
    const tabla = sinComentarios(readFileSync(join(process.cwd(), "src/app/promos/[id]/TablaDeRonda.tsx"), "utf8"));
    expect(tabla).toContain("() => filtraPorTienda(todasLasFilas, tiendaFiltro, clavesDeTienda),");
    expect(tabla).toContain("const orden = useOrdenYFiltro(filas, valorParaFiltrar);");
    expect(tabla).toContain("const cuenta = cuentaPorEstado(filas);");
    // Y dice cuántos esconde y por qué, en vez de dejar una tabla más corta sin explicación.
    expect(tabla).toContain("ocultos: menos de ${MINIMO_EN_LA_TIENDA} en ${tiendaFiltro}");
  });
});
