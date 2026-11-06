/**
 * Operaciones de almacén (D-883, migración 247): la cuenta de la merma.
 *
 * El dueño: la pérdida es **costo por pieza**. Piezas = cajas × piezas por caja + piezas sueltas. Desde el pedido
 * 0c2fb392 (migración 259) solo cuentan las piezas DAÑADAS: las que sirven de muestra no son pérdida. El costo se congela
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

// ---------------------------------------------------------------------------
// El reparto (pedido faa07047, migración 254): del total de piezas, cuántas están dañadas y cuántas sirven de muestra.
// Dañadas + muestra = total. La pérdida en $ es costo × piezas DAÑADAS (pedido 0c2fb392, migración 259): las de muestra
// no se pierden. Antes de la 259 contaban todas; la 259 recalculó los reportes que ya había.
// ---------------------------------------------------------------------------
export interface Reparto { damaged: number; sample: number }

/** ¿Cuadra? Enteros, nada negativo y dañadas + muestra = total. */
export function repartoValido(total: number, x: Partial<Reparto> | null | undefined): x is Reparto {
  if (!x || !entero(total) || total < 1) return false;
  const { damaged, sample } = x;
  return entero(damaged) && entero(sample) && damaged >= 0 && sample >= 0 && damaged + sample === total;
}

/**
 * El reparto para un total: conserva las de muestra que ya había (hasta el total) y el resto son dañadas. Sin reparto
 * previo, todo dañado; o todo muestra si viene de un borrador viejo con la opción única «muestra».
 */
export function repartoAjustado(total: number, previo?: Partial<Reparto> | null, tipoViejo?: unknown): Reparto {
  if (!entero(total) || total < 0) return { damaged: 0, sample: 0 };
  if (previo && entero(previo.sample) && previo.sample >= 0) {
    const sample = Math.min(previo.sample, total);
    return { damaged: total - sample, sample };
  }
  if (previo && entero(previo.damaged) && previo.damaged >= 0) {
    const damaged = Math.min(previo.damaged, total);
    return { damaged, sample: total - damaged };
  }
  return tipoViejo === "sample" ? { damaged: 0, sample: total } : { damaged: total, sample: 0 };
}

/**
 * Al escribir uno de los dos números, el otro se llena solo con lo que falta (rápido en el teléfono). Si lo escrito
 * no es un entero o se pasa del total, se deja tal cual (el paso no avanza) y el otro queda en 0.
 */
export function repartoAlCambiar(total: number, campo: keyof Reparto, valor: number): Reparto {
  const resto = entero(valor) && valor >= 0 && valor <= total ? total - valor : 0;
  return campo === "damaged" ? { damaged: valor, sample: resto } : { damaged: resto, sample: valor };
}

/** La pérdida en $ de una merma: costo por pieza × piezas dañadas (las de muestra no cuentan). Null sin costo. */
export function perdidaDeMerma(costoPorPieza: number | null | undefined, x: Reparto): number | null {
  return perdida(costoPorPieza, x.damaged);
}

/** Lo que va a `scrap_type`: todo dañado, todo muestra, o de los dos. */
export function tipoDeReparto(x: Reparto): "damaged" | "sample" | "mixed" {
  return x.sample === 0 ? "damaged" : x.damaged === 0 ? "sample" : "mixed";
}

/**
 * El reparto de un reporte guardado. Los de antes de la 254 no traen las dos cuentas: tenían una sola opción
 * (dañado o muestra) para todas las piezas.
 */
export function repartoDeReporte(r: { scrap_type: string | null; total_pieces: number | null; damaged_pieces?: number | null; sample_pieces?: number | null }): Reparto {
  if (r.damaged_pieces != null && r.sample_pieces != null) return { damaged: r.damaged_pieces, sample: r.sample_pieces };
  const total = r.total_pieces ?? 0;
  return r.scrap_type === "sample" ? { damaged: 0, sample: total } : { damaged: total, sample: 0 };
}
