/**
 * RTG PROMOS — leer el Excel de promociones. **La mitad pura**: aquí no se abre ningún fichero.
 *
 * Quien lee el libro (`exceljs`, en el servidor) lo deja en una estructura tonta —hojas, filas,
 * celdas tal cual vienen— y todo lo que decide qué es un producto vive aquí, donde se prueba sin
 * fichero y sin librería. Plan: `docs/PLAN-140-promos.md`, §10.
 *
 * Las reglas salen de MEDIR el libro real (`9.25.26 Promo`), no de suponer. Cada una está aquí
 * porque el libro tiene un caso que la rompe si falta:
 *
 *   · **Los encabezados están en la fila 2**, no en la 1: la 1 lleva un rótulo `QOH` suelto encima
 *     de las columnas de tienda.
 *   · **Una hoja es de productos por su fila 2, no por su nombre.** Así la hoja de reglas del dueño
 *     se cae sola y ningún nombre de hoja vive en este fichero — el libro del mes que viene puede
 *     renombrarlas.
 *   · **Las columnas de tienda se descubren, no se listan**: son las que van entre `MO` y `COST`, y
 *     se llaman como diga el encabezado. Ni un código de tienda escrito aquí.
 *   · **`COST` llega a veces como la cadena vacía**, no como `null`. `Number("")` es `0`, así que un
 *     lector ingenuo registra costo cero y la pantalla enseña un margen inventado. Ausente es
 *     ausente.
 *   · **`DIFF` viene en tres formas** dentro de la misma hoja (fórmula, maestra de fórmula
 *     compartida, y seguidora). Solo el `result` está en las tres; el `formula` no.
 *   · **`FMPGC` y `FMPGC 3.5GAL` son dos productos distintos.** El código se recorta por los lados y
 *     no se le tocan los espacios de dentro.
 *   · **Una fila con descripción pero sin código no es un producto** (el libro trae tres así,
 *     epígrafes escritos a mano).
 *
 * Nada se descarta en silencio: lo que no entra sale en `avisos`, y la pantalla de subida se los
 * enseña al admin antes de confirmar la ronda.
 */

// ---------------------------------------------------------------------------
// La costura con `exceljs`: lo que deja en `cell.value`, y nada más.
// ---------------------------------------------------------------------------

/** Una celda tal como la entrega `exceljs`. Las tres formas con `result` son las de una fórmula. */
export type Celda =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | { result?: unknown; formula?: string; sharedFormula?: string; ref?: string; shareType?: string }
  | { richText: { text: string }[] }
  | { text: string };

export interface HojaCruda {
  nombre: string;
  /** Las filas de la hoja, de la 1 en adelante; cada una, sus celdas de la A en adelante. */
  filas: Celda[][];
}

// ---------------------------------------------------------------------------
// Lo que sale
// ---------------------------------------------------------------------------

export interface ProductoPromo {
  code: string;
  supplier: string | null;
  size: string | null;
  description: string | null;
  notes: string | null;
  qoh: number | null;
  demand: number | null;
  monthsOfStock: number | null;
  /** Existencias por tienda, con la clave que diga el encabezado del libro. */
  qohByStore: Record<string, number | null>;
  cost: number | null;
  price: number | null;
  diff: number | null;
  /** De qué hoja salió, tal cual se llama. */
  sourceSheet: string;
  /** Su fila en esa hoja, contando desde 1 — para que el admin la encuentre. */
  rowNo: number;
}

export interface SugerenciaPromo {
  code: string;
  /** El grupo de tiendas cuya hoja lo sugería. */
  groupCode: string;
}

export type TipoDeAviso =
  | "hoja-ignorada"
  | "fila-sin-codigo"
  | "codigo-repetido"
  | "sugerido-fuera-del-universo"
  | "grupo-sin-hoja";

export interface AvisoPromo {
  tipo: TipoDeAviso;
  hoja: string;
  /** La fila, contando desde 1, cuando el aviso es de una fila concreta. */
  fila?: number;
  detalle: string;
}

export interface ResultadoPromo {
  /** Todos los productos del libro, sin repetir código. */
  productos: ProductoPromo[];
  /** Qué sugería la hoja de cada grupo. */
  sugerencias: SugerenciaPromo[];
  /** Todo lo que se decidió no meter, y por qué. Nunca se descarta nada callando. */
  avisos: AvisoPromo[];
}

// ---------------------------------------------------------------------------
// Celdas
// ---------------------------------------------------------------------------

/** El valor de dentro de una celda, sea del tipo que sea. Una fórmula vale lo que vale su `result`. */
function valor(c: Celda): string | number | boolean | Date | null {
  if (c === null || c === undefined) return null;
  if (typeof c === "object") {
    if (c instanceof Date) return c;
    if ("richText" in c) return c.richText.map((r) => r.text).join("");
    // `result` puede existir y valer `undefined`: es una fórmula que el libro no traía calculada.
    // Eso es AUSENTE, no cero — de ahí que se compruebe la clave y luego el valor.
    if ("result" in c) {
      const r = (c as { result?: unknown }).result;
      if (r === null || r === undefined) return null;
      if (typeof r === "string" || typeof r === "number" || typeof r === "boolean") return r;
      if (r instanceof Date) return r;
      return null;
    }
    if ("text" in c) return c.text;
    return null;
  }
  return c;
}

/** Texto de una celda, recortado **por los lados y nada más**. Vacío es ausente. */
export function texto(c: Celda): string | null {
  const v = valor(c);
  if (v === null) return null;
  const t = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return t === "" ? null : t;
}

/**
 * Número de una celda. La cadena vacía, el nulo y una fórmula sin calcular son **ausentes**, no
 * cero: en el libro real cinco productos traen `COST` como `""`, y `Number("")` vale 0.
 */
export function numero(c: Celda): number | null {
  const v = valor(c);
  if (v === null || typeof v === "boolean" || v instanceof Date) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Reconocer una hoja de productos
// ---------------------------------------------------------------------------

const normaliza = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

/** Los encabezados fijos, en orden. Entre `MO` y `COST` va lo que el libro quiera: son las tiendas. */
const ANTES_DE_LAS_TIENDAS = ["SUPPLIER", "SIZE", "UNIFIED CODE", "UNIFIED DESCRIPTION", "NOTES", "QOH", "DEMAND", "MO"] as const;
const DESPUES_DE_LAS_TIENDAS = ["COST", "PRICE", "DIFF"] as const;

/** Dónde está cada cosa en una hoja de productos. Los índices son de columna, desde 0. */
export interface DisposicionDeHoja {
  /** Índices de las ocho fijas de la izquierda, en el orden de `ANTES_DE_LAS_TIENDAS`. */
  izquierda: number[];
  /** Una por columna de tienda: su nombre según el encabezado, y su índice. */
  tiendas: { nombre: string; indice: number }[];
  /** Índices de COST, PRICE y DIFF. */
  derecha: number[];
}

/**
 * ¿Es una hoja de productos? Lo dice su **fila 2**: los ocho encabezados de la izquierda, luego al
 * menos una columna de tienda, luego COST/PRICE/DIFF. Si no encaja, devuelve `null` — y quien
 * llama lo anota; no es un error, es una hoja que no es de esto.
 */
export function disposicionDe(filas: Celda[][]): DisposicionDeHoja | null {
  const cabecera = (filas[1] ?? []).map((c) => {
    const t = texto(c);
    return t === null ? "" : normaliza(t);
  });
  const izquierda: number[] = [];
  for (const nombre of ANTES_DE_LAS_TIENDAS) {
    const i = cabecera.indexOf(nombre, izquierda.length ? izquierda[izquierda.length - 1] + 1 : 0);
    if (i < 0) return null;
    izquierda.push(i);
  }
  const derecha: number[] = [];
  let desde = izquierda[izquierda.length - 1] + 1;
  for (const nombre of DESPUES_DE_LAS_TIENDAS) {
    const i = cabecera.indexOf(nombre, desde);
    if (i < 0) return null;
    derecha.push(i);
    desde = i + 1;
  }
  const tiendas: { nombre: string; indice: number }[] = [];
  for (let i = izquierda[izquierda.length - 1] + 1; i < derecha[0]; i++) {
    const nombre = cabecera[i];
    if (nombre !== "") tiendas.push({ nombre, indice: i });
  }
  // Sin ninguna columna entre MO y COST no es esta hoja: sería otro libro con los mismos rótulos.
  if (tiendas.length === 0) return null;
  return { izquierda, tiendas, derecha };
}

// ---------------------------------------------------------------------------
// El lector
// ---------------------------------------------------------------------------

function productoDeFila(fila: Celda[], d: DisposicionDeHoja, hoja: string, rowNo: number): ProductoPromo | null {
  const [iSup, iSize, iCode, iDesc, iNotes, iQoh, iDemand, iMo] = d.izquierda;
  const code = texto(fila[iCode]);
  if (code === null) return null;
  const qohByStore: Record<string, number | null> = {};
  for (const t of d.tiendas) qohByStore[t.nombre] = numero(fila[t.indice]);
  return {
    code,
    supplier: texto(fila[iSup]),
    size: texto(fila[iSize]),
    description: texto(fila[iDesc]),
    notes: texto(fila[iNotes]),
    qoh: numero(fila[iQoh]),
    demand: numero(fila[iDemand]),
    monthsOfStock: numero(fila[iMo]),
    qohByStore,
    cost: numero(fila[d.derecha[0]]),
    price: numero(fila[d.derecha[1]]),
    diff: numero(fila[d.derecha[2]]),
    sourceSheet: hoja,
    rowNo,
  };
}

const vacia = (fila: Celda[]) => fila.every((c) => texto(c) === null);

/**
 * Lee el libro entero.
 *
 * `gruposConocidos` son los códigos de grupo de tiendas que el admin ya cruzó en Ajustes. Una hoja
 * que se llame como uno de ellos es **sugerencias de ese grupo**; cualquier otra hoja de productos
 * es **universo**. Con la lista vacía —el día que se estrena esto, antes de que nadie cruce nada—
 * todo es universo y no hay sugerencias, que es lo honesto: sin el cruce no se puede saber de quién
 * era esa hoja.
 *
 * Nada se pierde callando: un código sugerido que no esté en el universo **se añade** al universo y
 * se avisa; un grupo conocido sin hoja se avisa; una hoja que no es de productos se avisa.
 */
export function leePromo(hojas: readonly HojaCruda[], gruposConocidos: readonly string[] = []): ResultadoPromo {
  const avisos: AvisoPromo[] = [];
  const grupoDe = new Map<string, string>();
  for (const g of gruposConocidos) {
    const t = g.trim();
    if (t !== "") grupoDe.set(normaliza(t), t);
  }

  const productos: ProductoPromo[] = [];
  const porCodigo = new Map<string, ProductoPromo>();
  const sugerencias: SugerenciaPromo[] = [];
  const gruposConHoja = new Set<string>();

  // Dos pasadas: primero el universo, porque «sugerido fuera del universo» no se puede saber hasta
  // que el universo está completo.
  const deProductos: { hoja: HojaCruda; d: DisposicionDeHoja; grupo: string | null }[] = [];
  for (const hoja of hojas) {
    const d = disposicionDe(hoja.filas);
    if (!d) {
      avisos.push({ tipo: "hoja-ignorada", hoja: hoja.nombre, detalle: "su fila 2 no son los encabezados de una hoja de productos" });
      continue;
    }
    const grupo = grupoDe.get(normaliza(hoja.nombre)) ?? null;
    if (grupo !== null) gruposConHoja.add(grupo);
    deProductos.push({ hoja, d, grupo });
  }

  const filasDe = (hoja: HojaCruda, d: DisposicionDeHoja) => {
    const out: { p: ProductoPromo; rowNo: number }[] = [];
    for (let i = 2; i < hoja.filas.length; i++) {
      const fila = hoja.filas[i] ?? [];
      const rowNo = i + 1;
      if (vacia(fila)) continue;
      const p = productoDeFila(fila, d, hoja.nombre, rowNo);
      if (p === null) {
        avisos.push({
          tipo: "fila-sin-codigo", hoja: hoja.nombre, fila: rowNo,
          detalle: `sin «Unified Code»${texto(fila[d.izquierda[3]]) ? `; decía «${texto(fila[d.izquierda[3]])}»` : ""}`,
        });
        continue;
      }
      out.push({ p, rowNo });
    }
    return out;
  };

  // Solo se llama cuando el código NO está todavía, salvo en la pasada del universo, donde un
  // repetido es lo que se quiere cazar. Gana el primero, y se dice de dónde venía.
  const anota = (p: ProductoPromo, rowNo: number, hoja: string) => {
    const previo = porCodigo.get(p.code);
    if (previo) {
      const donde = previo.sourceSheet === hoja ? `la fila ${previo.rowNo}` : `«${previo.sourceSheet}», fila ${previo.rowNo}`;
      avisos.push({ tipo: "codigo-repetido", hoja, fila: rowNo, detalle: `«${p.code}» ya estaba en ${donde}; gana el primero` });
      return false;
    }
    porCodigo.set(p.code, p);
    productos.push(p);
    return true;
  };

  for (const { hoja, d, grupo } of deProductos) {
    if (grupo !== null) continue;
    for (const { p, rowNo } of filasDe(hoja, d)) anota(p, rowNo, hoja.nombre);
  }

  for (const { hoja, d, grupo } of deProductos) {
    if (grupo === null) continue;
    for (const { p, rowNo } of filasDe(hoja, d)) {
      if (!porCodigo.has(p.code)) {
        // No estaba en el universo. Se CONSERVA: perderlo sería inventar que la hoja no lo decía.
        anota(p, rowNo, hoja.nombre);
        avisos.push({
          tipo: "sugerido-fuera-del-universo", hoja: hoja.nombre, fila: rowNo,
          detalle: `«${p.code}» solo aparece en esta hoja; se conserva`,
        });
      }
      sugerencias.push({ code: p.code, groupCode: grupo });
    }
  }

  for (const grupo of grupoDe.values()) {
    if (!gruposConHoja.has(grupo)) {
      avisos.push({ tipo: "grupo-sin-hoja", hoja: grupo, detalle: `el libro no trae ninguna hoja para el grupo «${grupo}»` });
    }
  }

  return { productos, sugerencias, avisos };
}

/**
 * Una huella de lo que el servidor leyó del libro, para que **lo que se confirma sea lo que se
 * vio**.
 *
 * Subir es de dos pasos: `preview` analiza y no escribe, `commit` escribe. Entre uno y otro el
 * admin puede elegir otro fichero sin darse cuenta —el segundo `<input type="file">` no sabe del
 * primero— y entonces confirmaría unos avisos que eran de otro libro. `commit` vuelve a leer el
 * fichero él mismo y compara esta huella con la que devolvió `preview`; si no casan, no escribe.
 *
 * **No es criptografía y no pretende serlo**: no protege de nadie que quiera engañar al servidor
 * —el servidor lee el fichero por su cuenta, así que no hay nada que falsificar— sino de un
 * despiste. Por eso es una FNV-1a de 32 bits escrita aquí mismo: determinista, sin dependencias, y
 * probable sin navegador.
 */
export function huellaDeLectura(r: ResultadoPromo): string {
  const canonico = [
    r.productos.length,
    r.sugerencias.length,
    r.avisos.length,
    ...r.productos.map((p) => `${p.code}|${p.sourceSheet}|${p.rowNo}|${p.cost ?? ""}|${p.price ?? ""}|${p.qoh ?? ""}`),
    ...r.sugerencias.map((s) => `${s.groupCode}>${s.code}`),
    ...r.avisos.map((a) => `${a.tipo}@${a.hoja}#${a.fila ?? ""}`),
  ].join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < canonico.length; i++) {
    h ^= canonico.charCodeAt(i);
    // El desplazamiento de FNV-1a, en aritmética de 32 bits sin signo.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
