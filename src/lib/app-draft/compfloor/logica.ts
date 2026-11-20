/**
 * App Draft · Comp Floor: funciones puras (conversiones de unidad, lotes, precios, reservas, reparto de stock escaso).
 * Sin React ni navegador: se prueban con vitest.
 */
import type { Articulo, Cliente, EstadoCf, Existencia, LineaPedido, NivelDePrecio, Pedido, Tienda, Unidad } from "./tipos";

export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Cuántas cajas son `cantidad` en `unidad` (sin redondear). */
export function aCajas(a: Articulo, cantidad: number, unidad: Unidad): number {
  if (!(cantidad > 0)) return 0;
  if (unidad === "box") return cantidad;
  if (unidad === "sqft") return a.sqftPorCaja > 0 ? cantidad / a.sqftPorCaja : 0;
  return a.piezasPorCaja > 0 ? cantidad / a.piezasPorCaja : 0;
}

/** Lo que pidió el cliente, redondeado hacia arriba a cajas enteras, con sus equivalencias. */
export function convertir(a: Articulo, cantidad: number, unidad: Unidad): { exactas: number; cajas: number; sqft: number; piezas: number; sobraSqft: number } {
  const exactas = aCajas(a, cantidad, unidad);
  // Tolerancia para no subir una caja por un error de coma flotante.
  const cajas = Math.max(0, Math.ceil(exactas - 1e-9));
  const sqft = r2(cajas * a.sqftPorCaja);
  const pedidoSqft = unidad === "sqft" ? cantidad : exactas * a.sqftPorCaja;
  return { exactas: r2(exactas), cajas, sqft, piezas: cajas * a.piezasPorCaja, sobraSqft: r2(Math.max(0, sqft - pedidoSqft)) };
}

/** Cajas apartadas hoy por pedidos abiertos, por renglón de stock. */
export function reservadoPorExistencia(e: Pick<EstadoCf, "pedidos">): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of e.pedidos) {
    if (p.etapa !== "order") continue;
    for (const l of p.lineas) if (l.existenciaId && l.reservadas > 0) m[l.existenciaId] = (m[l.existenciaId] ?? 0) + l.reservadas;
  }
  return m;
}

/** Libre para vender = en el estante − apartado por pedidos. */
export function libreDe(x: Existencia, reservado: Record<string, number>): number {
  return Math.max(0, x.cajas - (reservado[x.id] ?? 0));
}

export interface LoteEncontrado { existencia: Existencia; libre: number; alcanza: boolean }

/**
 * La consulta de mostrador: «¿hay N cajas de UN solo lote?». Devuelve cada renglón del artículo con lo libre y si
 * alcanza para todo el trabajo; primero los que alcanzan, luego la tienda pedida, luego el que más tiene. Lo apartado
 * para un cliente (pedido especial) no se ofrece.
 */
export function buscarLotes(e: Pick<EstadoCf, "existencias" | "pedidos">, articuloId: string, cajas: number, tienda?: Tienda | null): LoteEncontrado[] {
  const res = reservadoPorExistencia(e);
  return e.existencias
    .filter((x) => x.articuloId === articuloId && x.cajas > 0 && !x.apartadoPara)
    .map((x) => { const libre = libreDe(x, res); return { existencia: x, libre, alcanza: cajas > 0 && libre >= cajas }; })
    .sort((a, b) => Number(b.alcanza) - Number(a.alcanza)
      || Number(b.existencia.tienda === tienda) - Number(a.existencia.tienda === tienda)
      || b.libre - a.libre);
}

/** ¿Las líneas del mismo artículo salen de lotes distintos? Devuelve los artículos que mezclan lotes. */
export function mezclaDeLotes(lineas: readonly { articuloId: string; existenciaId: string | null }[], existencias: readonly Existencia[]): string[] {
  const lotes: Record<string, Set<string>> = {};
  for (const l of lineas) {
    if (!l.existenciaId) continue;
    const x = existencias.find((y) => y.id === l.existenciaId);
    if (!x) continue;
    (lotes[l.articuloId] ??= new Set()).add(`${x.lote}|${x.tono}`);
  }
  return Object.keys(lotes).filter((k) => lotes[k].size > 1);
}

export interface PrecioAplicado { precio: number; regla: "list" | "level" | "fixed"; remanente: boolean }

/** El precio por caja para un cliente: fijo del nivel > % del nivel > lista; luego el descuento de remanente. */
export function precioPara(a: Articulo, tipo: Cliente["tipo"] | null, niveles: readonly NivelDePrecio[], x?: Existencia | null): PrecioAplicado {
  const n = tipo ? niveles.find((v) => v.tipo === tipo) : undefined;
  let precio = a.precioCaja;
  let regla: PrecioAplicado["regla"] = "list";
  if (n && n.fijos[a.id] != null) { precio = n.fijos[a.id]; regla = "fixed"; }
  else if (n && n.descuentoPct > 0) { precio = a.precioCaja * (1 - n.descuentoPct / 100); regla = "level"; }
  const pct = x?.remanentePct ?? 0;
  if (pct > 0) precio = precio * (1 - pct / 100);
  return { precio: r2(precio), regla, remanente: pct > 0 };
}

export const pendienteDe = (l: LineaPedido) => Math.max(0, l.cajas - l.reservadas - l.enviadas);
export const totalDeLineas = (ls: readonly { cajas: number; precioCaja: number }[]) => r2(ls.reduce((s, l) => s + l.cajas * l.precioCaja, 0));

export type EstadoPedido = "quote" | "ready" | "backorder" | "partial" | "done";

export function estadoDePedido(p: Pedido): EstadoPedido {
  if (p.etapa === "quote") return "quote";
  if (p.etapa === "closed" || p.lineas.every((l) => l.enviadas >= l.cajas)) return "done";
  if (p.lineas.some((l) => pendienteDe(l) > 0)) return "backorder";
  return p.lineas.some((l) => l.enviadas > 0) ? "partial" : "ready";
}

/**
 * Cotización → pedido: cada línea aparta del lote elegido lo que haya libre; lo que falte queda «por surtir»
 * (backorder). Si la línea no trae lote, toma el lote de la tienda del pedido que más tenga libre.
 */
export function convertirAPedido(e: Pick<EstadoCf, "existencias" | "pedidos">, p: Pedido): Pedido {
  const otros = { ...e, pedidos: e.pedidos.filter((x) => x.id !== p.id) };
  const res = reservadoPorExistencia(otros);
  const usado: Record<string, number> = {};
  const lineas = p.lineas.map((l) => {
    if (l.ocId) return l;
    let exId = l.existenciaId;
    if (!exId) exId = buscarLotes(otros, l.articuloId, l.cajas, p.tienda).find((f) => f.existencia.tienda === p.tienda)?.existencia.id ?? null;
    const x = exId ? e.existencias.find((y) => y.id === exId) : undefined;
    const libre = x ? Math.max(0, libreDe(x, res) - (usado[x.id] ?? 0)) : 0;
    const reservadas = Math.min(libre, Math.max(0, l.cajas - l.enviadas));
    if (x) usado[x.id] = (usado[x.id] ?? 0) + reservadas;
    return { ...l, existenciaId: exId, reservadas };
  });
  return { ...p, etapa: "order", lineas };
}

export interface Pendiente { pedidoId: string; lineaId: string; fecha: string; prioridad: number; falta: number; existenciaId: string | null }

/** Las líneas por surtir de un artículo, en el orden en que se surten: prioridad, luego la más vieja. */
export function pendientesDeArticulo(pedidos: readonly Pedido[], articuloId: string): Pendiente[] {
  const out: Pendiente[] = [];
  for (const p of pedidos) {
    if (p.etapa !== "order") continue;
    for (const l of p.lineas) {
      if (l.articuloId === articuloId && !l.ocId && pendienteDe(l) > 0) {
        out.push({ pedidoId: p.id, lineaId: l.id, fecha: p.fecha, prioridad: p.prioridad, falta: pendienteDe(l), existenciaId: l.existenciaId });
      }
    }
  }
  return out.sort((a, b) => a.prioridad - b.prioridad || a.fecha.localeCompare(b.fecha));
}

/**
 * Reparte `libre` cajas de UN lote entre los pendientes en su orden; nadie recibe más de lo que le falta. Una línea que
 * ya aparta de otro lote no recibe de éste (sería mezclar lotes en el mismo trabajo).
 */
export function repartirStock(libre: number, pendientes: readonly Pendiente[], existenciaId?: string): { lineaId: string; pedidoId: string; cajas: number }[] {
  let queda = Math.max(0, Math.floor(libre));
  const out: { lineaId: string; pedidoId: string; cajas: number }[] = [];
  for (const p of pendientes) {
    if (queda <= 0) break;
    if (existenciaId && p.existenciaId && p.existenciaId !== existenciaId) continue;
    const c = Math.min(queda, p.falta);
    if (c > 0) { out.push({ lineaId: p.lineaId, pedidoId: p.pedidoId, cajas: c }); queda -= c; }
  }
  return out;
}

/** ¿Se puede cargar `monto` a la cuenta del cliente sin pasar su límite? */
export function cabeEnCuenta(c: Pick<Cliente, "limite" | "saldo"> | null | undefined, monto: number): { ok: boolean; disponible: number } {
  if (!c || c.limite == null) return { ok: false, disponible: 0 };
  const disponible = r2(c.limite - c.saldo);
  return { ok: monto <= disponible + 1e-9, disponible };
}

/** El siguiente número de una serie con prefijo: uno más que el mayor que exista. */
export function siguiente(existentes: readonly string[], prefijo: string, primero: number): string {
  let max = primero - 1;
  for (const n of existentes) {
    if (!n.startsWith(prefijo)) continue;
    const v = Number(n.slice(prefijo.length));
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `${prefijo}${max + 1}`;
}

export function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function sumaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
