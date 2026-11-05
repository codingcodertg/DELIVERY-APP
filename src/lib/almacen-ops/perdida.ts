/**
 * Operaciones de almacén (D-883, migración 247): la cuenta de la merma.
 *
 * El dueño: la pérdida es **costo por pieza**. Piezas = cajas × piezas por caja + piezas sueltas. El costo se congela
 * al reportar (la base copia `erp.products.cost` en `unit_cost`), así que cambiar un precio después no mueve los
 * reportes viejos. La base hace la MISMA cuenta en `warehouse_ops_file_report`; esto es para la pantalla.
 */

export interface Cantidades { boxes: number; piecesPerBox: number; loosePieces: number }

const entero = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** ¿Se puede guardar? Enteros, nada negativo, al menos una pieza por caja y al menos una pieza en total. */
export function cantidadesValidas(c: Partial<Cantidades> | null | undefined): c is Cantidades {
  if (!c) return false;
  const { boxes, piecesPerBox, loosePieces } = c;
  if (!entero(boxes) || !entero(piecesPerBox) || !entero(loosePieces)) return false;
  if (boxes < 0 || loosePieces < 0 || piecesPerBox < 1) return false;
  return piezasTotales(c as Cantidades) >= 1;
}

export function piezasTotales(c: Cantidades): number {
  return c.boxes * c.piecesPerBox + c.loosePieces;
}

/** La pérdida en $, redondeada a centavos; null si el producto no tiene costo. */
export function perdida(costoPorPieza: number | null | undefined, piezas: number): number | null {
  if (costoPorPieza == null || !Number.isFinite(costoPorPieza)) return null;
  return Math.round(costoPorPieza * piezas * 100) / 100;
}

/** Piezas por caja con que arranca el paso: la del producto, o 1 si no la tiene. */
export function piezasPorCajaInicial(delProducto: number | null | undefined): number {
  return entero(delProducto) && delProducto >= 1 ? delProducto : 1;
}

/** Un texto del campo numérico a entero ≥ 0 (vacío = 0). NaN si no es un número entero. */
export function enteroDelCampo(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export interface FilaDeMerma { created_at: string; store: string; total_loss: number | null }

/** Inicio de la semana (domingo, como Tile Ops) y del mes, en la hora local de `ahora`. */
export function iniciosDePeriodo(ahora: Date): { semana: Date; mes: Date } {
  const semana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - ahora.getDay());
  const mes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  return { semana, mes };
}

export interface TotalesDeMerma { semana: number; mes: number; todo: number }

/** La pérdida de esta semana, este mes y de siempre, por tienda (y «*» = todas). */
export function totalesPorTienda(filas: readonly FilaDeMerma[], ahora: Date): Record<string, TotalesDeMerma> {
  const { semana, mes } = iniciosDePeriodo(ahora);
  const out: Record<string, TotalesDeMerma> = {};
  const suma = (k: string, f: FilaDeMerma, v: number) => {
    const t = (out[k] ??= { semana: 0, mes: 0, todo: 0 });
    const at = new Date(f.created_at);
    t.todo += v;
    if (at >= mes) t.mes += v;
    if (at >= semana) t.semana += v;
  };
  for (const f of filas) {
    const v = f.total_loss ?? 0;
    suma("*", f, v);
    suma(f.store, f, v);
  }
  for (const t of Object.values(out)) { t.semana = r2(t.semana); t.mes = r2(t.mes); t.todo = r2(t.todo); }
  return out;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
