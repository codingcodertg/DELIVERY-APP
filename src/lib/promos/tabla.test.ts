import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ordenaFilas, filtraFilas } from "@/lib/orden-y-filtro";
import {
  cambioEnBloque, clavesDeTiendaDe, columnasDePromos, columnasDePromosPorDefecto, COLUMNAS_FIJAS,
  cuentaPorEstado, esDecisorDePromos, filaDePromo, filasDePromo, grupoDeLaTienda, LARGO_DE_NOTA,
  motivoParaNoDecidir, puedeDecidir,
  valorDeColumna, valorParaFiltrar, type DecisionDeGrupo, type ProductoDeCatalogo,
} from "./tabla";

/**
 * Los valores son inventados. Las **formas** están medidas: el costo llega de la base con toda su
 * precisión de coma flotante, y las existencias vienen por tienda con la clave del libro.
 */
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
    expect([...COLUMNAS_FIJAS]).toEqual(["code", "estado", "nota"]);
  });

  it("por defecto se ven todas", () => {
    expect(columnasDePromosPorDefecto(["AA1"], true)).toEqual(columnasDePromos(["AA1"], true).map((c) => c.key));
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
