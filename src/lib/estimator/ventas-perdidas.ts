import type { SupabaseClient } from "@supabase/supabase-js";
import { filasACsv, nombreCsv } from "@/lib/security/csv";
import { faltaLaTabla, type Resultado } from "./almacen";

/**
 * Ventas perdidas (pestaña «Ventas perdidas / Lost sales» del Quote Builder): lo que un cliente quiso comprar y no
 * había en la tienda. El dueño lo pidió por solicitud de ayuda: «they want to add a tab where they can record the items
 * that they lost a sale on because we didn't have stock».
 *
 * Es un registro de demanda no atendida, no un documento del cliente: no va atado a `estimator_quotes`. Vive en
 * `estimator_lost_sales` (migración 308). Quién ve, anota y borra lo decide la base (`has_estimator_access()`: admin o
 * el módulo `estimator`; el borrado es lógico y solo lo puede hacer quien anotó o el admin). Aquí están las reglas que
 * se prueban sin red: validar, filtrar, resumir, el CSV y la pareja base/demo.
 */

export const MOTIVOS_DE_PERDIDA = ["out_of_stock", "not_enough_stock", "discontinued", "other"] as const;
export type MotivoDePerdida = (typeof MOTIVOS_DE_PERDIDA)[number];

export const UNIDADES_DE_PERDIDA = ["SF", "boxes", "pieces", "bags", "other"] as const;
export type UnidadDePerdida = (typeof UNIDADES_DE_PERDIDA)[number];

export const TOPES_DE_PERDIDA = { articulo: 200, cliente: 120, tienda: 80, notas: 500 } as const;

/** Una venta perdida como la devuelve la base (las columnas de `COLUMNAS`). */
export interface VentaPerdida {
  id: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  store: string | null;
  /** AAAA-MM-DD, en hora de Texas. */
  sale_date: string;
  item: string;
  quantity: number | null;
  unit: UnidadDePerdida | null;
  est_value: number | null;
  reason: MotivoDePerdida;
  customer: string | null;
  notes: string | null;
}

/** Lo que el formulario escribe. Los números van como `number | null`; el texto, sin recortar. */
export interface MetaDePerdida {
  store: string;
  sale_date: string;
  item: string;
  quantity: number | null;
  unit: UnidadDePerdida | "";
  est_value: number | null;
  reason: MotivoDePerdida;
  customer: string;
  notes: string;
}

export const metaDePerdidaVacia = (tienda = "", hoy = ""): MetaDePerdida => ({
  store: tienda, sale_date: hoy, item: "", quantity: null, unit: "", est_value: null,
  reason: "out_of_stock", customer: "", notes: "",
});

/** ¿Falta algo para anotarla? Solo el artículo y la fecha: sin ellos, la fila no dice qué se perdió ni cuándo. */
export function faltaEnPerdida(meta: Pick<MetaDePerdida, "item" | "sale_date">): "articulo" | "fecha" | null {
  if (!meta.item.trim()) return "articulo";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.sale_date)) return "fecha";
  return null;
}

/** Lo que se manda a la tabla. Sin `created_by`, `created_by_name` ni `created_at`: los pone el disparador. */
export function filaDePerdida(meta: MetaDePerdida) {
  const corta = (v: string, n: number) => v.trim().slice(0, n) || null;
  const numero = (v: number | null) => (v !== null && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);
  return {
    store: corta(meta.store, TOPES_DE_PERDIDA.tienda),
    sale_date: meta.sale_date,
    item: meta.item.trim().slice(0, TOPES_DE_PERDIDA.articulo),
    quantity: numero(meta.quantity),
    unit: meta.unit || null,
    est_value: numero(meta.est_value),
    reason: meta.reason,
    customer: corta(meta.customer, TOPES_DE_PERDIDA.cliente),
    notes: corta(meta.notes, TOPES_DE_PERDIDA.notas),
  };
}

/** Quita quien la anotó o el admin: la misma regla que la política de UPDATE de la 308. */
export function puedeQuitarPerdida(p: Pick<VentaPerdida, "created_by">, yo: { id: string; admin: boolean }): boolean {
  if (yo.admin) return true;
  return !!yo.id && p.created_by === yo.id;
}

/** El rango y la tienda de la pestaña. Fechas AAAA-MM-DD; vacío en tienda = todas. */
export interface FiltroDePerdidas { desde: string; hasta: string; tienda: string }

/** Las filas que caen en el rango (ambas fechas incluidas) y en la tienda. Las mismas reglas que la consulta. */
export function filtraPerdidas(lista: readonly VentaPerdida[], f: FiltroDePerdidas): VentaPerdida[] {
  return lista.filter((p) => {
    if (f.desde && p.sale_date < f.desde) return false;
    if (f.hasta && p.sale_date > f.hasta) return false;
    if (f.tienda && (p.store ?? "") !== f.tienda) return false;
    return true;
  });
}

/** De la fecha de venta más nueva a la más vieja; dentro de un día, la anotada más tarde primero. */
export function masNuevaPrimero(lista: readonly VentaPerdida[]): VentaPerdida[] {
  return [...lista].sort((a, b) => {
    if (a.sale_date !== b.sale_date) return a.sale_date < b.sale_date ? 1 : -1;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
}

export interface ResumenDePerdidas {
  filas: number;
  /** Suma de `est_value` (las filas sin valor no suman). */
  dinero: number;
  /** Cuántas filas traen valor: para decir «3 de 10 con valor». */
  conValor: number;
  porTienda: { tienda: string; filas: number; dinero: number }[];
  /** Los artículos que más se pidieron y no había, por número de filas (de mayor a menor), máximo 5. */
  topArticulos: { articulo: string; filas: number }[];
}

/** Los totales de la pestaña: cuántas, cuánto dinero, por tienda y los artículos que más se repiten. */
export function resumenDePerdidas(lista: readonly VentaPerdida[]): ResumenDePerdidas {
  const tiendas = new Map<string, { tienda: string; filas: number; dinero: number }>();
  const articulos = new Map<string, { articulo: string; filas: number }>();
  let dinero = 0;
  let conValor = 0;
  for (const p of lista) {
    const valor = p.est_value ?? 0;
    dinero += valor;
    if (p.est_value !== null) conValor += 1;
    const t = p.store?.trim() || "—";
    const st = tiendas.get(t) ?? { tienda: t, filas: 0, dinero: 0 };
    st.filas += 1;
    st.dinero += valor;
    tiendas.set(t, st);
    const clave = p.item.trim().toLowerCase();
    const ar = articulos.get(clave) ?? { articulo: p.item.trim(), filas: 0 };
    ar.filas += 1;
    articulos.set(clave, ar);
  }
  return {
    filas: lista.length,
    dinero: Math.round(dinero * 100) / 100,
    conValor,
    porTienda: [...tiendas.values()].sort((a, b) => b.filas - a.filas || a.tienda.localeCompare(b.tienda)),
    topArticulos: [...articulos.values()]
      .sort((a, b) => b.filas - a.filas || a.articulo.localeCompare(b.articulo))
      .slice(0, 5),
  };
}

/** El CSV de la pestaña: las mismas columnas que la tabla, con el texto ya en el idioma de quien lo baja. */
export function csvDePerdidas(
  lista: readonly VentaPerdida[],
  rotulos: { motivo: (m: MotivoDePerdida) => string; cabeceras: readonly string[] },
  hoy: string,
): { nombre: string; csv: string } {
  const filas = lista.map((p) => [
    p.sale_date, p.store ?? "", p.created_by_name ?? "", p.item, p.quantity, p.unit ?? "",
    rotulos.motivo(p.reason), p.est_value, p.customer ?? "", p.notes ?? "",
  ]);
  return { nombre: nombreCsv("ventas-perdidas", hoy), csv: filasACsv(rotulos.cabeceras, filas) };
}

// ---- dónde se guarda ---------------------------------------------------------------------------------

export interface AlmacenDePerdidas {
  /** Las no borradas en el rango y la tienda, de la más nueva a la más vieja. Sin la 308, `sinTabla`. */
  listar(f: FiltroDePerdidas): Promise<Resultado<VentaPerdida[]>>;
  anotar(meta: MetaDePerdida): Promise<Resultado<VentaPerdida>>;
  /** Borrado lógico (`deleted_at`). La base decide quién puede: quien la anotó o el admin. */
  quitar(p: Pick<VentaPerdida, "id">): Promise<Resultado<null>>;
}

const COLUMNAS = "id, created_at, created_by, created_by_name, store, sale_date, item, quantity, unit, est_value, reason, customer, notes";
/** Tope de la lista: de sobra para una tienda en un mes; con techo, por si el rango es el año entero. */
export const TOPE_DE_PERDIDAS = 1000;

type ErrorDePerdidas = { code?: string | null; message?: string | null } | null;
function falla<T>(error: ErrorDePerdidas): Resultado<T> {
  return { ok: false, sinTabla: faltaLaTabla(error), error: error?.message ?? "error" };
}

export function almacenDePerdidasDeLaBase(supabase: SupabaseClient): AlmacenDePerdidas {
  return {
    async listar(f) {
      let q = supabase.from("estimator_lost_sales").select(COLUMNAS);
      if (f.desde) q = q.gte("sale_date", f.desde);
      if (f.hasta) q = q.lte("sale_date", f.hasta);
      if (f.tienda) q = q.eq("store", f.tienda);
      const { data, error } = await q
        .order("sale_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(TOPE_DE_PERDIDAS);
      if (error) return falla(error);
      return { ok: true, valor: (data ?? []) as VentaPerdida[] };
    },
    async anotar(meta) {
      const { data, error } = await supabase.from("estimator_lost_sales").insert(filaDePerdida(meta)).select(COLUMNAS);
      if (error) return falla(error);
      const fila = (data as VentaPerdida[] | null)?.[0];
      if (!fila) return { ok: false, sinTabla: false, error: "0 rows" };
      return { ok: true, valor: fila };
    },
    async quitar(p) {
      // Sin `.select()`: al borrarla, la política de SELECT deja de ver la fila y pedirla de vuelta daría error.
      // La pantalla vuelve a leer la lista, que es la prueba de que se quitó.
      const { error } = await supabase.from("estimator_lost_sales").update({ deleted_at: new Date().toISOString() }).eq("id", p.id);
      if (error) return falla(error);
      return { ok: true, valor: null };
    },
  };
}

/** Cuatro filas inventadas para el demo. Ninguna es real. */
function semillaDemo(hoy: string): VentaPerdida[] {
  const dia = (atras: number) => {
    const d = new Date(`${hoy}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - atras);
    return d.toISOString().slice(0, 10);
  };
  const base = { created_by: "u-sales", created_by_name: "Sam Sales", customer: null, notes: null, quantity: null, unit: null, est_value: null };
  return [
    { ...base, id: "demo-vp-1", created_at: `${dia(0)}T15:10:00Z`, store: "Edinburg", sale_date: dia(0), item: "Porcelain tile 12x24 gray (PT-1224)", quantity: 240, unit: "SF", est_value: 1450, reason: "out_of_stock", customer: "Cliente demo A", notes: "Quería el lote de mayo" },
    { ...base, id: "demo-vp-2", created_at: `${dia(1)}T17:40:00Z`, store: "Weslaco", sale_date: dia(1), item: "Cement board 3x5 1/2", quantity: 12, unit: "pieces", est_value: 264, reason: "not_enough_stock", created_by: "u-sales2", created_by_name: "Sofia Ventas" },
    { ...base, id: "demo-vp-3", created_at: `${dia(3)}T13:05:00Z`, store: "Edinburg", sale_date: dia(3), item: "Porcelain tile 12x24 gray (PT-1224)", quantity: 120, unit: "SF", est_value: 725, reason: "out_of_stock" },
    { ...base, id: "demo-vp-4", created_at: `${dia(6)}T10:20:00Z`, store: "Pharr", sale_date: dia(6), item: "Vinyl plank oak (discontinued line)", quantity: 8, unit: "boxes", reason: "discontinued", customer: "Cliente demo B", notes: "Ya no lo fabrican", created_by: "u-sales3", created_by_name: "Pablo Pharr" },
  ];
}

/** El demo en memoria: la misma interfaz que la base, con el mismo filtro y el mismo borrado lógico. */
export function almacenDePerdidasDemo(
  me: () => { id: string; name: string; admin: boolean; store?: string | null },
  sinTabla: boolean,
  hoy: string,
): AlmacenDePerdidas {
  const filas: VentaPerdida[] = semillaDemo(hoy);
  let n = 0;
  const sinTablaRes = { ok: false as const, sinTabla: true, error: "demo: sin la 308" };
  return {
    async listar(f) {
      if (sinTabla) return sinTablaRes;
      return { ok: true, valor: masNuevaPrimero(filtraPerdidas(filas, f)).map((p) => ({ ...p })) };
    },
    async anotar(meta) {
      if (sinTabla) return sinTablaRes;
      const yo = me();
      n += 1;
      const fila = filaDePerdida(meta);
      const nueva: VentaPerdida = {
        ...fila,
        id: `demo-vp-n${n}`,
        created_at: new Date().toISOString(),
        created_by: yo.id,
        created_by_name: yo.name,
        store: fila.store ?? (yo.store?.trim() || null),
        unit: fila.unit as UnidadDePerdida | null,
      };
      filas.push(nueva);
      return { ok: true, valor: { ...nueva } };
    },
    async quitar(p) {
      if (sinTabla) return sinTablaRes;
      const yo = me();
      const i = filas.findIndex((x) => x.id === p.id);
      if (i < 0) return { ok: false, sinTabla: false, error: "demo: not found" };
      if (!puedeQuitarPerdida(filas[i], yo)) return { ok: false, sinTabla: false, error: "demo: not allowed" };
      filas.splice(i, 1);
      return { ok: true, valor: null };
    },
  };
}
