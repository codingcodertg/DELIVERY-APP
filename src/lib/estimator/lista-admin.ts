import { centralWallToUtc } from "@/lib/clockin/tz";
import { shiftDateISO } from "@/lib/utils";

/**
 * La lista de TODAS las cotizaciones, solo para el admin (D-NEXT). El dueño, 2026-10-06: «en el quote builder solo
 * para admin habilita la lista de todas las quotes ya hechas y las de los comeptirodes tambien».
 *
 * Aquí vive lo que decide, sin red: **quién ve la pestaña** (solo `admin`, la misma palabra que `profiles.role` y que
 * `is_admin()` en la RLS de la 148), el **filtro** (vendedor, tienda, fechas y texto), el **orden** (de la más reciente a
 * la más vieja) y las **tandas** (de 50 en 50). La base ya deja al admin leer todas las filas de `estimator_quotes`
 * (148: `is_admin()` en la política de SELECT) y todos los estimados de la competencia (156: `has_estimator_access()`),
 * así que no hace falta migración: la pantalla solo pinta lo que la RLS devuelve, y a quien no es admin ni le ofrece
 * la pestaña.
 *
 * Las mismas funciones las usan el demo (en memoria) y la base (por PostgREST): `cumpleFiltro` para filas que ya se
 * tienen, `aplicaFiltro` para pedírselas a la base. Las dos leen el MISMO `FiltroDeCotizaciones`, para que el demo no
 * mienta sobre lo que haría la base.
 */

export type Pestana = "cotizacion" | "competencia" | "todas";

/**
 * Solo el admin ve la lista de todas (`profiles.role = 'admin'`, lo que `page.tsx` pasa como `me.admin` y lo que
 * `is_admin()` mira en la RLS). Un gerente con el módulo no: es la palabra del dueño («solo para admin»).
 */
export function puedeVerTodas(me: { admin: boolean } | null | undefined): boolean {
  return me?.admin === true;
}

/** Una cotización como la lista la pestaña: lo justo para reconocerla, sin las líneas ni el teléfono del cliente. */
export interface CotizacionResumen {
  id: string;
  estimate_num: string;
  owner_id: string | null;
  /** El nombre del dueño, por `profiles` (la 099 deja leer `full_name` a cualquier sesión). */
  owner_name: string | null;
  store: string | null;
  customer_name: string;
  /** El total estimado de materiales, con impuesto: el mismo que ve el vendedor bajo la hoja (D-442). */
  total: number;
  print_count: number;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vendedor {
  id: string;
  full_name: string | null;
  store: string | null;
}

export interface FiltroDeCotizaciones {
  /** El id del dueño; vacío = todos. */
  vendedor: string;
  /** La tienda de la cotización; vacío = todas. */
  tienda: string;
  /** Días de Texas, `YYYY-MM-DD`, los dos incluidos; vacío = sin límite. */
  desde: string;
  hasta: string;
  /** Busca en el # de estimado y en el nombre del cliente (el vendedor tiene su desplegable). */
  texto: string;
}

export const filtroVacio = (): FiltroDeCotizaciones => ({ vendedor: "", tienda: "", desde: "", hasta: "", texto: "" });

export function hayFiltro(f: FiltroDeCotizaciones): boolean {
  return !!(f.vendedor || f.tienda || f.desde || f.hasta || f.texto.trim());
}

/** Cuántas se cargan por tanda. Hoy (2026-10-06) hay 3 en producción; con 50 la lista se lee entera de un golpe. */
export const TANDA = 50;

export type EstadoDeCotizacion = "impresa" | "guardada";

/** Impresa si se generó la copia del cliente alguna vez (la 148 cuenta cada impresión); si no, guardada sin imprimir. */
export function estadoDeCotizacion(c: Pick<CotizacionResumen, "print_count" | "printed_at">): EstadoDeCotizacion {
  return c.print_count > 0 || !!c.printed_at ? "impresa" : "guardada";
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Los dos instantes (UTC) que encierran los días de Texas del filtro: desde la medianoche de `desde` hasta la
 * medianoche del día SIGUIENTE a `hasta`, excluida. Una cotización de las 9 de la noche en Texas es de ese día, no del
 * siguiente en UTC (como las encuestas, D-449). Un extremo vacío o mal escrito no limita.
 */
export function limitesDeFechas(f: Pick<FiltroDeCotizaciones, "desde" | "hasta">): { desde: string | null; hasta: string | null } {
  return {
    desde: DIA.test(f.desde) ? centralWallToUtc(`${f.desde}T00:00`) : null,
    hasta: DIA.test(f.hasta) ? centralWallToUtc(`${shiftDateISO(f.hasta, 1)}T00:00`) : null,
  };
}

/**
 * ¿El texto del filtro casa con esta cotización? Sin mayúsculas; en el # de estimado y en el nombre del cliente, los
 * mismos dos sitios que mira la base (`filtroDeTextoPostgrest`): el demo no debe encontrar lo que la base no encontraría.
 */
export function textoCoincide(c: Pick<CotizacionResumen, "estimate_num" | "customer_name">, texto: string): boolean {
  const t = texto.trim().toLowerCase();
  if (!t) return true;
  return [c.estimate_num, c.customer_name].some((v) => v.toLowerCase().includes(t));
}

/** El filtro sobre filas que ya se tienen (el demo, y la prueba de que la base pide lo mismo). */
export function cumpleFiltro(c: CotizacionResumen, f: FiltroDeCotizaciones): boolean {
  if (f.vendedor && c.owner_id !== f.vendedor) return false;
  if (f.tienda && (c.store ?? "") !== f.tienda) return false;
  const { desde, hasta } = limitesDeFechas(f);
  if (desde && c.created_at < desde) return false;
  if (hasta && c.created_at >= hasta) return false;
  return textoCoincide(c, f.texto);
}

/** De la más reciente a la más vieja, por cuándo se creó; a igual instante, por id, para que las tandas no bailen. */
export function masRecientePrimero<T extends { created_at: string; id: string }>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * Qué filas pide la tanda `n` (desde 0): `TANDA + 1`, para saber si hay más sin una segunda consulta. `cortaTanda`
 * se queda con las `TANDA` primeras y dice si sobró alguna.
 */
export function rangoDeTanda(n: number): { desde: number; hasta: number } {
  const desde = Math.max(0, Math.floor(n)) * TANDA;
  return { desde, hasta: desde + TANDA };
}

export function cortaTanda<T>(filas: readonly T[]): { filas: T[]; hayMas: boolean } {
  return { filas: filas.slice(0, TANDA), hayMas: filas.length > TANDA };
}

/** Una tanda de la lista, ya filtrada y ordenada, sobre filas en memoria (el demo). */
export function tandaEnMemoria(todas: readonly CotizacionResumen[], f: FiltroDeCotizaciones, n: number): { filas: CotizacionResumen[]; hayMas: boolean } {
  const { desde, hasta } = rangoDeTanda(n);
  return cortaTanda(masRecientePrimero(todas.filter((c) => cumpleFiltro(c, f))).slice(desde, hasta + 1));
}

/**
 * El texto, como lo pide PostgREST en un `or=(...)`: `ilike` sobre el # y sobre el nombre del cliente dentro del
 * `jsonb`. El valor va entre comillas dobles (así una coma o un paréntesis no rompen la lista) y sin lo que podría
 * cerrarlas; `%` y `_` se escapan para que no sean comodines.
 */
export function filtroDeTextoPostgrest(texto: string): string | null {
  const t = texto.trim().replace(/["\\]/g, "").replace(/[%_]/g, (c) => `\\${c}`);
  if (!t) return null;
  const v = `"*${t}*"`;
  return `estimate_num.ilike.${v},customer->>full_name.ilike.${v}`;
}

/**
 * Lo mínimo que la consulta de la base tiene que saber hacer. Así se prueba con un falso qué se le pide, y el
 * constructor de PostgREST (cuyos tipos genéricos hacen que `tsc` se pierda) se le pasa con un `as`.
 */
export interface ConsultaFiltrable<Q> {
  eq(columna: string, valor: string): Q;
  gte(columna: string, valor: string): Q;
  lt(columna: string, valor: string): Q;
  or(filtros: string): Q;
}
export type Consulta = ConsultaFiltrable<Consulta>;

/** El mismo filtro que `cumpleFiltro`, dicho a la base. */
export function aplicaFiltro(q: Consulta, f: FiltroDeCotizaciones): Consulta {
  let c = q;
  if (f.vendedor) c = c.eq("owner_id", f.vendedor);
  if (f.tienda) c = c.eq("store", f.tienda);
  const { desde, hasta } = limitesDeFechas(f);
  if (desde) c = c.gte("created_at", desde);
  if (hasta) c = c.lt("created_at", hasta);
  const texto = filtroDeTextoPostgrest(f.texto);
  if (texto) c = c.or(texto);
  return c;
}

/** Las tiendas para el desplegable: las de Ajustes más las que traen las filas cargadas, sin repetir ni vacías. */
export function tiendasDelFiltro(deAjustes: readonly string[], filas: readonly { store: string | null }[]): string[] {
  return [...new Set([...deAjustes, ...filas.map((c) => c.store ?? "")])].filter(Boolean);
}
