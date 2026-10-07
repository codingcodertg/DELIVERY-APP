import { centralWallToUtc } from "@/lib/clockin/tz";
import { fechaHora } from "@/lib/encuestas/resumen";
import { claveDeFiltro, type FiltrosPorColumna, type ValorDeCelda } from "@/lib/orden-y-filtro";
import {
  daysBetween, endOfMonthISO, endOfWeekISO, isoInTZ, shiftDateISO, shiftMonthISO, startOfMonthISO, startOfWeekISO, todayISO,
} from "@/lib/utils";

/**
 * La lista de TODAS las cotizaciones, solo para el admin (D-476). El dueño, 2026-10-06: «en el quote builder solo
 * para admin habilita la lista de todas las quotes ya hechas y las de los comeptirodes tambien».
 *
 * D-484: la ven todos los del módulo; el admin con todas, los demás solo con las suyas (`alcanceDeLista`), y nace ordenada
 * por pies cuadrados (`ORDEN_INICIAL`, columna `sf`).
 *
 * Aquí vive lo que decide, sin red: **quién ve todas** (solo `admin`, la misma palabra que `profiles.role` y que
 * `is_admin()` en la RLS de la 148), el **filtro que va a la base** (fechas y texto), el **orden** (de la más reciente a
 * la más vieja), las **tandas** (de 50 en 50), el **rango de fechas con sus atajos** (el calendario del Panel, D-478) y
 * **lo que cada columna saca de una fila** para el menú de ordenar y filtrar de las tablas de la casa (D-275/D-360).
 * Vendedor, tienda y estado se filtran por columna sobre lo cargado, como en Órdenes; a la base solo van fechas y texto. La base ya deja al admin leer todas las filas de `estimator_quotes`
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

// ---- quién ve qué en la lista (D-484) ---------------------------------------------------------------------------------
//
// El dueño (2026-10-06): «esa misma, donde uno se mete para ver todas las órdenes que se han hecho, pero cada user también
// va a tener acceso a eso, pero ese user solo va a poder ver las órdenes que él ha hecho». La pestaña deja de ser solo del
// admin: todo el que entra al Quote Builder (el `layout` ya exige el módulo `estimator`) la ve; el admin, con TODAS; los
// demás, solo con las que ellos crearon (`owner_id`) y los estimados de la competencia que ellos subieron.

/** Qué filas pide la lista: todas (admin) o solo las de un dueño. Nunca «todas» por olvido: el no-admin lleva su id. */
export type AlcanceDeLista = { todas: true } | { todas: false; dueno: string };

/**
 * El alcance de la lista para quien mira, o null si no se le enseña (sin sesión conocida). Un no-admin sin id NO cae
 * en «todas»: se queda sin lista. Lo que decide «admin» es lo mismo que `puedeVerTodas`.
 */
export function alcanceDeLista(me: { id?: string | null; admin: boolean } | null | undefined): AlcanceDeLista | null {
  if (puedeVerTodas(me)) return { todas: true };
  const id = me?.id?.trim();
  return id ? { todas: false, dueno: id } : null;
}

/** ¿Se ofrece la pestaña? A quien tenga alcance: el admin, o cualquiera con sesión dentro del módulo. */
export function puedeVerLista(me: { id?: string | null; admin: boolean } | null | undefined): boolean {
  return alcanceDeLista(me) !== null;
}

/** ¿Esta cotización entra en el alcance? (el demo, y la prueba de que la base pide lo mismo). */
export function enElAlcance(c: Pick<CotizacionResumen, "owner_id">, a: AlcanceDeLista): boolean {
  return a.todas || c.owner_id === a.dueno;
}

/** El alcance dicho a la base: el no-admin pide `owner_id = su id`, en la consulta, no solo en pantalla. */
export function aplicaAlcance(q: Consulta, a: AlcanceDeLista): Consulta {
  return a.todas ? q : q.eq("owner_id", a.dueno);
}

/** Los estimados de la competencia que entran: todos (admin) o los que subió el dueño del alcance. */
export function subidoPorDelAlcance(a: AlcanceDeLista): string | null {
  return a.todas ? null : a.dueno;
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
  /** Los pies cuadrados pedidos: la suma de `requested_sf` de sus líneas por SF (D-484, `piesCuadradosPedidos`). */
  sf: number;
  /** El total estimado de materiales, con impuesto: el mismo que ve el vendedor bajo la hoja (D-442). */
  total: number;
  print_count: number;
  printed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Lo que se le pide a la base: fechas y texto. Vendedor, tienda y estado se filtran por columna sobre lo cargado. */
export interface FiltroDeCotizaciones {
  /** Días de Texas, `YYYY-MM-DD`, los dos incluidos; vacío = sin límite. */
  desde: string;
  hasta: string;
  /** Busca en el # de estimado y en el nombre del cliente. */
  texto: string;
}

export const filtroVacio = (): FiltroDeCotizaciones => ({ desde: "", hasta: "", texto: "" });

export function hayFiltro(f: FiltroDeCotizaciones): boolean {
  return !!(f.desde || f.hasta || f.texto.trim());
}

/** Cuántas se cargan por tanda. Hoy (2026-10-06) hay 3 en producción; con 50 la lista se lee entera de un golpe. */
export const TANDA = 50;

/**
 * Los pies cuadrados pedidos de una cotización (D-484, «el sort sea por square feet»): la suma de `requested_sf` de las
 * líneas por SF. Las de unidad («Installation Materials, 1 Lot») no tienen superficie y no suman; una línea sin SF
 * escrito, o con un número que no es positivo, tampoco. Son los pedidos, no los que salen en cajas completas (`sfReal`).
 */
export function piesCuadradosPedidos(lineas: readonly { kind: string; requested_sf?: number | null }[]): number {
  let total = 0;
  for (const l of lineas) {
    if (l.kind !== "sf") continue;
    const sf = l.requested_sf;
    if (typeof sf === "number" && Number.isFinite(sf) && sf > 0) total += sf;
  }
  return Math.round(total * 100) / 100;
}

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

/** ¿El instante cae dentro del rango de fechas del filtro? Un extremo vacío no limita. */
export function enElRango(iso: string, f: Pick<FiltroDeCotizaciones, "desde" | "hasta">): boolean {
  const { desde, hasta } = limitesDeFechas(f);
  if (desde && iso < desde) return false;
  if (hasta && iso >= hasta) return false;
  return true;
}

/** El filtro sobre filas que ya se tienen (el demo, y la prueba de que la base pide lo mismo). */
export function cumpleFiltro(c: CotizacionResumen, f: FiltroDeCotizaciones): boolean {
  return enElRango(c.created_at, f) && textoCoincide(c, f.texto);
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
export function tandaEnMemoria(
  todas: readonly CotizacionResumen[], f: FiltroDeCotizaciones, n: number, a: AlcanceDeLista,
): { filas: CotizacionResumen[]; hayMas: boolean } {
  const { desde, hasta } = rangoDeTanda(n);
  return cortaTanda(masRecientePrimero(todas.filter((c) => enElAlcance(c, a) && cumpleFiltro(c, f))).slice(desde, hasta + 1));
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
  const { desde, hasta } = limitesDeFechas(f);
  if (desde) c = c.gte("created_at", desde);
  if (hasta) c = c.lt("created_at", hasta);
  const texto = filtroDeTextoPostgrest(f.texto);
  if (texto) c = c.or(texto);
  return c;
}

// ---- el calendario del Panel: el rango de fechas con sus atajos (D-478) ---------------------------------------------
//
// El dueño (2026-10-06): «PON EL CALENDARIO QUE SIEMPRE HEMOS PEUSTO». Es el del Panel (`dashboard/page.tsx`): ◀ Desde
// Hasta ▶ · Hoy · Esta semana · Este mes · Mes pasado. Aquí, además, «Todo» (sin fechas), que es como nace la lista.
// Las cuentas son las mismas que allí, con las funciones de `utils`; lo único que cambia es que viven fuera de la pantalla
// para probarlas.

/** Cómo se mueve el rango con ◀ ▶: una semana salta 7 días, un mes salta de mes en mes, uno a mano salta su propio largo. */
export type ModoDeRango = "week" | "month" | "custom";

export interface RangoDeFechas { desde: string; hasta: string; modo: ModoDeRango }

/** El rango tal como lo deja el Panel: «hasta» nunca pasa de hoy. */
export function rangoAcotado(desde: string, hasta: string, modo: ModoDeRango, hoy: string = todayISO()): RangoDeFechas {
  return { desde, hasta: hasta > hoy ? hoy : hasta, modo };
}

export type AtajoDeRango = "hoy" | "semana" | "mes" | "mes-pasado" | "todo";

/** Lo que pone cada botón de atajo. `ahora` solo para fijar «hoy» en una prueba. */
export function rangoDeAtajo(atajo: AtajoDeRango, ahora: Date = new Date()): RangoDeFechas {
  const hoy = isoInTZ(ahora);
  if (atajo === "todo") return { desde: "", hasta: "", modo: "custom" };
  if (atajo === "hoy") return rangoAcotado(hoy, hoy, "custom", hoy);
  if (atajo === "semana") return rangoAcotado(startOfWeekISO(ahora), endOfWeekISO(ahora), "week", hoy);
  if (atajo === "mes") return rangoAcotado(startOfMonthISO(ahora), endOfMonthISO(ahora), "month", hoy);
  const ancla = new Date(shiftMonthISO(startOfMonthISO(ahora), -1) + "T12:00:00");
  return rangoAcotado(startOfMonthISO(ancla), endOfMonthISO(ancla), "month", hoy);
}

/** ◀ ▶ sobre el rango actual, como `step` del Panel. Sin fechas no hay por dónde moverse: se queda igual. */
export function pasoDeRango(r: RangoDeFechas, dir: 1 | -1, hoy: string = todayISO()): RangoDeFechas {
  if (!r.desde || !r.hasta) return r;
  if (r.modo === "month") {
    const a = new Date(shiftMonthISO(r.desde, dir) + "T12:00:00");
    return rangoAcotado(startOfMonthISO(a), endOfMonthISO(a), "month", hoy);
  }
  if (r.modo === "week") return rangoAcotado(shiftDateISO(r.desde, dir * 7), shiftDateISO(r.hasta, dir * 7), "week", hoy);
  const largo = daysBetween(r.hasta, r.desde) + 1;
  return rangoAcotado(shiftDateISO(r.desde, dir * largo), shiftDateISO(r.hasta, dir * largo), "custom", hoy);
}

/** Qué atajo está encendido con este rango (para pintar su botón en azul), o null si es uno a mano. */
export function atajoEncendido(r: Pick<RangoDeFechas, "desde" | "hasta" | "modo">, ahora: Date = new Date()): AtajoDeRango | null {
  if (!r.desde && !r.hasta) return "todo";
  for (const a of ["hoy", "semana", "mes", "mes-pasado"] as const) {
    const x = rangoDeAtajo(a, ahora);
    if (x.desde === r.desde && x.hasta === r.hasta && (a === "hoy" || x.modo === r.modo)) return a;
  }
  return null;
}

// ---- las columnas, con el menú de ordenar y filtrar de las tablas de la casa (D-275 / D-360) -------------------------

export type ClaveDeColumna = "fecha" | "estimado" | "vendedor" | "tienda" | "cliente" | "sf" | "total" | "estado";

export const COLUMNAS_DE_LA_TABLA: readonly { key: ClaveDeColumna; en: string; es: string }[] = [
  { key: "fecha", en: "Date", es: "Fecha" },
  { key: "estimado", en: "Estimate #", es: "# de estimado" },
  { key: "vendedor", en: "Sales rep", es: "Vendedor" },
  { key: "tienda", en: "Store", es: "Tienda" },
  { key: "cliente", en: "Customer", es: "Cliente" },
  { key: "sf", en: "SF", es: "Pies²" },
  { key: "total", en: "Total", es: "Total" },
  { key: "estado", en: "Status", es: "Estado" },
];

/** Las columnas según el alcance: quien solo ve las suyas no tiene columna (ni filtro) de Vendedor, siempre sería él. */
export function columnasDeLaLista(a: AlcanceDeLista): readonly { key: ClaveDeColumna; en: string; es: string }[] {
  return a.todas ? COLUMNAS_DE_LA_TABLA : COLUMNAS_DE_LA_TABLA.filter((c) => c.key !== "vendedor");
}

/**
 * Cómo nace ordenada la lista (D-484): por pies cuadrados, de mayor a menor. El menú de cada columna lo cambia; «✕»
 * en el orden vuelve al de la base (la más reciente primero).
 */
export const ORDEN_INICIAL = { clave: "sf", direccion: "desc" } as const satisfies { clave: ClaveDeColumna; direccion: "asc" | "desc" };

/** El texto del estado en el idioma de la pantalla; es lo que filtra y lo que se pinta, una sola cosa. */
export function textoDeEstado(c: Pick<CotizacionResumen, "print_count" | "printed_at">, t: (en: string, es: string) => string): string {
  if (estadoDeCotizacion(c) === "guardada") return t("Saved, not printed", "Guardada, sin imprimir");
  return `${t("Printed", "Impresa")}${c.print_count > 1 ? ` ×${c.print_count}` : ""}`;
}

/**
 * Lo que cada columna saca de una fila, para ordenar y filtrar (`useOrdenYFiltro`). La fecha ordena y filtra por el
 * día de Texas (así el menú ofrece días, no instantes); el total es número; lo vacío es null («—» en el menú).
 */
export function valorDeColumna(clave: string, c: CotizacionResumen, t: (en: string, es: string) => string): ValorDeCelda {
  switch (clave as ClaveDeColumna) {
    case "fecha": return c.created_at ? isoInTZ(new Date(c.created_at)) : null;
    case "estimado": return c.estimate_num || null;
    case "vendedor": return c.owner_name;
    case "tienda": return c.store;
    case "cliente": return c.customer_name || null;
    case "sf": return c.sf;
    case "total": return c.total;
    case "estado": return textoDeEstado(c, t);
    default: return null;
  }
}

/** La fecha y hora que se pinta en la celda (la columna filtra por el día). */
export const fechaDeCelda = (iso: string): string => (iso ? fechaHora(iso) : "—");

/**
 * Los estimados de la competencia, debajo, heredan los mismos filtros que la tabla, sin cajas propias (D-478): el
 * rango de fechas (por cuándo se subió), el texto (cliente, competidor, #, nota, quién, archivo: el de D-451) y los
 * filtros de columna de **Vendedor** (quién lo subió) y **Tienda**. Los demás filtros de columna (#, cliente, total,
 * estado) son de la cotización y no se aplican aquí.
 */
export function filtraCompetenciaComoLaTabla<E extends { uploaded_at: string; uploaded_by_name: string | null; store: string | null }>(
  estimados: readonly E[], f: FiltroDeCotizaciones, filtros: FiltrosPorColumna, textoCasa: (e: E, texto: string) => boolean,
): E[] {
  const vendedores = filtros.vendedor?.size ? filtros.vendedor : null;
  const tiendas = filtros.tienda?.size ? filtros.tienda : null;
  return estimados.filter((e) =>
    enElRango(e.uploaded_at, f)
    && textoCasa(e, f.texto)
    && (!vendedores || vendedores.has(claveDeFiltro(e.uploaded_by_name)))
    && (!tiendas || tiendas.has(claveDeFiltro(e.store))));
}
