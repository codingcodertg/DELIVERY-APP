import { redondeaDinero } from "@/lib/totales";
import type { ValorDeCelda } from "@/lib/orden-y-filtro";

/**
 * RTG PROMOS — la tabla de decisiones, **sin React**.
 *
 * Qué columnas hay, qué valor tiene cada celda para ordenar y filtrar, qué estado lleva cada
 * producto y qué filas se escriben al aprobar en bloque. Todo aquí, y probado sin navegador; la
 * pantalla solo pinta lo que esto decide. El ordenar y el filtrar en sí son los de `orden-y-filtro`
 * (D-360), que ya usan la tabla de Órdenes y el Gestor: aquí solo se dice **qué saca cada columna
 * de una fila**.
 */

export type EstadoDeDecision = "pending" | "approved" | "rejected";
export const ESTADOS: readonly EstadoDeDecision[] = ["pending", "approved", "rejected"];

/**
 * El grupo de promociones de una tienda, tal como lo pone el admin en Datos.
 *
 * **Es el gemelo en TypeScript de `promo_group_of_user()` de la 140**, y tiene que decidir lo mismo
 * que ella: si la pantalla creyera que alguien pertenece a un grupo y la base dijera otra cosa, el
 * botón de aprobar se ofrecería y la escritura la rechazaría la RLS **sin error**, con cero filas —
 * o sea, en silencio. Por eso compara igual que la función: recortando y **sin distinguir
 * mayúsculas**. Nulo es el valor seguro en los dos lados.
 *
 * (`gruposDeAjustes`, en `subida.ts`, mira lo mismo desde el otro lado: qué grupos existen.)
 */
export function grupoDeLaTienda(
  stores: readonly { name?: string | null; promo_group?: string | null }[] | null | undefined,
  nombreDeTienda: string | null | undefined,
): string | null {
  const buscado = (nombreDeTienda ?? "").trim().toLowerCase();
  if (!buscado) return null;
  for (const s of stores ?? []) {
    if ((s.name ?? "").trim().toLowerCase() !== buscado) continue;
    return (s.promo_group ?? "").trim() || null;
  }
  return null;
}

/** Una fila de `promo_catalog`. `private` llega **nulo** para quien no puede ver las cinco. */
export interface ProductoDeCatalogo {
  round_id: string;
  code: string;
  supplier: string | null;
  size: string | null;
  description: string | null;
  qoh: number | null;
  qoh_by_store: Record<string, number | null> | null;
  price: number | null;
  source_sheet: string;
  row_no: number | null;
  private: {
    notes: string | null;
    demand: number | null;
    months_of_stock: number | null;
    cost: number | null;
    diff: number | null;
  } | null;
}

export interface DecisionDeGrupo {
  round_id: string;
  code: string;
  group_code: string;
  status: EstadoDeDecision;
  note: string | null;
}

export interface FilaDePromo {
  code: string;
  description: string | null;
  supplier: string | null;
  size: string | null;
  qoh: number | null;
  /** Por tienda, con la clave que traía el libro. **Separadas aunque dos decidan juntas.** */
  porTienda: Record<string, number | null>;
  price: number | null;
  cost: number | null;
  diff: number | null;
  demand: number | null;
  mo: number | null;
  notes: string | null;
  sourceSheet: string;
  rowNo: number | null;
  estado: EstadoDeDecision;
  nota: string | null;
}

export interface ColumnaDePromos {
  key: string;
  en: string;
  es: string;
  ancho: number;
  /** Ordena como número. Lo demás, como texto. */
  numero?: boolean;
  /** Una de las cinco de `Sheet6`: solo existe si `private` no es nulo. */
  privada?: boolean;
  /** Las existencias de esta tienda. La clave es la del libro, no una de Ajustes. */
  tienda?: string;
}

/**
 * Las columnas que NO se pueden quitar. El código identifica la fila, y el estado y la nota son
 * para lo que se entra aquí: esconderlos dejaría una tabla que no sirve para decidir.
 */
export const COLUMNAS_FIJAS: readonly string[] = ["code", "estado", "nota"];

/**
 * El catálogo de columnas de una ronda.
 *
 * **Las de tienda son del DATO, no del código**: salen de las claves que el libro traía en
 * `qoh_by_store`, así que una tienda nueva aparece sola y ninguna se escribe aquí. Y salen
 * **separadas aunque dos tiendas decidan juntas** — son existencias de dos almacenes distintos, y
 * juntarlas escondería que una tiene el material y la otra no.
 *
 * Las cinco privadas solo existen si quien mira puede verlas. No se ofrecen apagadas: una columna
 * que no se puede rellenar es peor que una que no está.
 */
export function columnasDePromos(clavesDeTienda: readonly string[], puedeVerPrivadas: boolean): ColumnaDePromos[] {
  const out: ColumnaDePromos[] = [
    { key: "code", en: "Code", es: "Código", ancho: 130 },
    { key: "description", en: "Description", es: "Descripción", ancho: 280 },
    { key: "supplier", en: "Supplier", es: "Proveedor", ancho: 160 },
    { key: "size", en: "Size", es: "Tamaño", ancho: 80 },
    { key: "qoh", en: "QOH", es: "Existencias", ancho: 80, numero: true },
  ];
  for (const t of clavesDeTienda) {
    out.push({ key: `qoh_${t}`, en: `QOH ${t}`, es: `Existencias ${t}`, ancho: 76, numero: true, tienda: t });
  }
  out.push({ key: "price", en: "Price", es: "Precio", ancho: 84, numero: true });
  if (puedeVerPrivadas) {
    out.push(
      { key: "cost", en: "Cost", es: "Costo", ancho: 84, numero: true, privada: true },
      { key: "diff", en: "Margin", es: "Margen", ancho: 84, numero: true, privada: true },
      { key: "demand", en: "Demand", es: "Demanda", ancho: 90, numero: true, privada: true },
      { key: "mo", en: "Months of stock", es: "Meses de stock", ancho: 110, numero: true, privada: true },
      { key: "notes", en: "Notes", es: "Notas", ancho: 140, privada: true },
    );
  }
  out.push(
    { key: "estado", en: "Decision", es: "Decisión", ancho: 120 },
    { key: "nota", en: "Note", es: "Nota", ancho: 200 },
  );
  return out;
}

/** Por defecto se ven TODAS: quitar es una elección, no el punto de partida (igual que el Gestor). */
export function columnasDePromosPorDefecto(clavesDeTienda: readonly string[], puedeVerPrivadas: boolean): string[] {
  return columnasDePromos(clavesDeTienda, puedeVerPrivadas).map((c) => c.key);
}

/**
 * Las claves de tienda de una ronda, **en el orden del libro y sin repetir**.
 *
 * Se recorren todos los productos y no solo el primero: una fila a la que le faltara una tienda
 * dejaría esa columna fuera para toda la tabla.
 */
export function clavesDeTiendaDe(productos: readonly ProductoDeCatalogo[]): string[] {
  const out: string[] = [];
  const vistas = new Set<string>();
  for (const p of productos) {
    for (const k of Object.keys(p.qoh_by_store ?? {})) {
      if (vistas.has(k)) continue;
      vistas.add(k);
      out.push(k);
    }
  }
  return out;
}

/**
 * La fila que se pinta.
 *
 * **El dinero se redondea aquí**, con `redondeaDinero` (D-363): el costo llega de la base con toda
 * su precisión (`1.0472501936483345`, medido en el ensayo de la 140) y enseñarlo así no le sirve a
 * nadie. Se redondea **antes** de ordenar y filtrar a propósito: quien ordena, ordena por lo que
 * ve, y dos celdas que enseñan `1.05` tienen que empatar en vez de colocarse en un orden que la
 * pantalla no explica.
 */
export function filaDePromo(p: ProductoDeCatalogo, decision: DecisionDeGrupo | undefined): FilaDePromo {
  const dinero = (v: number | null | undefined) => (v == null ? null : redondeaDinero(v));
  return {
    code: p.code,
    description: p.description,
    supplier: p.supplier,
    size: p.size,
    qoh: p.qoh,
    porTienda: { ...(p.qoh_by_store ?? {}) },
    price: dinero(p.price),
    cost: dinero(p.private?.cost),
    diff: dinero(p.private?.diff),
    demand: p.private?.demand ?? null,
    mo: p.private?.months_of_stock ?? null,
    notes: p.private?.notes ?? null,
    sourceSheet: p.source_sheet,
    rowNo: p.row_no,
    estado: decision?.status ?? "pending",
    nota: decision?.note ?? null,
  };
}

/** Todas las filas de la ronda, casadas con las decisiones del grupo que se está mirando. */
export function filasDePromo(
  productos: readonly ProductoDeCatalogo[],
  decisiones: readonly DecisionDeGrupo[],
  grupo: string | null,
): FilaDePromo[] {
  const porCodigo = new Map<string, DecisionDeGrupo>();
  for (const d of decisiones) {
    // Sin grupo —un vendedor sin tienda, o el admin antes de elegir uno— no hay decisión que casar:
    // todo sale como pendiente en vez de coger la de un grupo cualquiera.
    if (grupo !== null && d.group_code === grupo) porCodigo.set(d.code, d);
  }
  return productos.map((p) => filaDePromo(p, porCodigo.get(p.code)));
}

/** Lo que una columna saca de una fila para ordenar y filtrar (`orden-y-filtro`, D-360). */
export function valorDeColumna(fila: FilaDePromo, clave: string): ValorDeCelda {
  if (clave.startsWith("qoh_")) return fila.porTienda[clave.slice(4)] ?? null;
  switch (clave) {
    case "code": return fila.code;
    case "description": return fila.description;
    case "supplier": return fila.supplier;
    case "size": return fila.size;
    case "qoh": return fila.qoh;
    case "price": return fila.price;
    case "cost": return fila.cost;
    case "diff": return fila.diff;
    case "demand": return fila.demand;
    case "mo": return fila.mo;
    case "notes": return fila.notes;
    case "estado": return fila.estado;
    case "nota": return fila.nota;
    default: return null;
  }
}

/**
 * Lo mismo, con los argumentos **al revés**: es la forma que pide `filtraFilas` y `opcionesDeFiltro`
 * de `orden-y-filtro`, que reciben `(clave, fila)`.
 *
 * Existe para que nadie tenga que acordarse de invertirlos. Dos funciones con los mismos dos
 * argumentos en distinto orden es un fallo que compila —las dos son `(a, b)` de tipos distintos,
 * así que aquí `tsc` sí lo caza, pero en un `any` no— y sobre todo es un fallo que se lee bien.
 */
export const valorParaFiltrar = (clave: string, fila: FilaDePromo): ValorDeCelda => valorDeColumna(fila, clave);

/** Cuántos hay de cada estado. Es lo que llevan los chips del filtro por estado. */
export function cuentaPorEstado(filas: readonly FilaDePromo[]): Record<EstadoDeDecision, number> {
  const out: Record<EstadoDeDecision, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const f of filas) out[f.estado] += 1;
  return out;
}

/**
 * Quién decide: el admin en cualquier grupo; Gerente de Oficina y Oficina, en el suyo.
 *
 * **Gemelo de `promo_is_decider()` (140)**, con la misma trampa que `grupoDeLaTienda`: si los dos
 * lados no dijeran lo mismo, la pantalla ofrecería el botón y la RLS rechazaría el `update` con
 * **cero filas y sin error**. Un `insert` sí da error; un `update` que no pasa la política, no.
 *
 * Lo que NO tiene gemelo es «puede ver las cinco columnas privadas», y a propósito: eso se lee del
 * DATO —si `promo_catalog.private` llegó nulo, no puede— en vez de volver a calcularlo aquí. Un
 * dato medido no puede discrepar de la base; una regla copiada, sí.
 */
export function esDecisorDePromos(opts: { rol: string | null | undefined; grupo: string | null }): boolean {
  if (opts.rol === "admin") return true;
  return (opts.rol === "manager" || opts.rol === "accounting") && opts.grupo !== null;
}

/**
 * **Una sola función decide si se puede decidir**, y la usan el botón de una fila, el de bloque y
 * el selector de estado. Si cada uno lo calculara por su cuenta, uno de ellos acabaría ofreciendo
 * una acción que la base rechaza — y el rechazo de una ronda cerrada es una EXCEPCIÓN del
 * disparador (140), o sea un error crudo en pantalla.
 */
export function puedeDecidir(opts: { esDecisor: boolean; grupo: string | null; rondaCerrada: boolean }): boolean {
  return opts.esDecisor && opts.grupo !== null && !opts.rondaCerrada;
}

/** Por qué no se puede, para decírselo en vez de dejar un botón apagado sin explicación. */
export function motivoParaNoDecidir(opts: { esDecisor: boolean; grupo: string | null; rondaCerrada: boolean }): { en: string; es: string } | null {
  if (puedeDecidir(opts)) return null;
  if (opts.rondaCerrada) {
    return { en: "This round is closed. An admin can reopen it.", es: "Esta ronda está cerrada. Un administrador puede reabrirla." };
  }
  if (!opts.esDecisor) {
    return { en: "Only the store's Office Manager or Office decides.", es: "Solo el Gerente de Oficina o la Oficina de la tienda decide." };
  }
  return {
    en: "Your store has no promo group yet. An admin sets it in Data → Stores.",
    es: "Tu tienda todavía no tiene grupo de promociones. Un administrador lo pone en Datos → Tiendas.",
  };
}

/**
 * Las filas que se escriben al decidir, en bloque o de una en una — **es la misma operación**.
 *
 * Van por `upsert` sobre la clave primaria `(round_id, code, group_code)`: un producto sin decidir
 * todavía no tiene fila, y uno ya decidido la tiene. Distinguir los dos casos en la pantalla sería
 * un `if` que se puede equivocar; la base ya sabe cuál es cuál.
 *
 * `decided_by` y `decided_at` **no se mandan**: los pisa el disparador de la 140 con `auth.uid()` y
 * `now()`. Mandarlos sería escribir algo que va a ser ignorado, y leerlo de vuelta como si lo
 * hubiéramos puesto nosotros.
 */
export function cambioEnBloque(opts: {
  roundId: string;
  grupo: string;
  codigos: readonly string[];
  estado: EstadoDeDecision;
  nota?: string | null;
}): { round_id: string; code: string; group_code: string; status: EstadoDeDecision; note: string | null }[] {
  const nota = opts.nota === undefined ? undefined : (opts.nota ?? "").trim() || null;
  const vistos = new Set<string>();
  const out: { round_id: string; code: string; group_code: string; status: EstadoDeDecision; note: string | null }[] = [];
  for (const code of opts.codigos) {
    if (vistos.has(code)) continue;
    vistos.add(code);
    out.push({
      round_id: opts.roundId,
      code,
      group_code: opts.grupo,
      status: opts.estado,
      // Sin nota en la llamada, la nota queda vacía. Es lo correcto para un cambio en bloque: no
      // hay una nota que valga para veinte productos, y conservar la que cada uno tuviera exigiría
      // leerlas antes — que es lo que hace la edición de una fila, donde sí se manda.
      note: nota ?? null,
    });
  }
  return out;
}

/** El tope de la nota, copiado de `promo_decisions_nota_tamano` (140). */
export const LARGO_DE_NOTA = 500;
