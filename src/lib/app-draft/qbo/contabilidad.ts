/**
 * App Draft · QuickBooks Online: toda la cuenta del prototipo en funciones puras (sin React, sin fechas del reloj salvo
 * las que se pasan). Cada documento genera renglones de libro BALANCEADOS (debe = haber) en `libroMayor`, y todos los
 * informes salen de ahí, así que cuadran entre sí.
 */
import type {
  Aplicacion, CreditoDeProveedor, Cuenta, EstadoQbo, Factura, FacturaProveedor, Linea, LineaDeAsiento, LineaDeGasto,
  NotaDeCredito, PagoAProveedor, PagoRecibido, RenglonDeLibro, TipoDeCuenta,
} from "./tipos";

/** Las cuentas fijas que la contabilidad necesita por número. */
export const CTA = {
  banco: "a-1000",
  porCobrar: "a-1200",
  inventario: "a-1300",
  porPagar: "a-2000",
  impuestos: "a-2100",
  capital: "a-3000",
  utilidades: "a-3900",
  costoVendido: "a-5000",
} as const;

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const suma = (xs: number[]) => r2(xs.reduce((a, b) => a + b, 0));
const CASI_CERO = 0.005;

// ---------------------------------------------------------------- fechas
export function diasEntre(desde: string, hasta: string): number {
  const a = Date.UTC(+desde.slice(0, 4), +desde.slice(5, 7) - 1, +desde.slice(8, 10));
  const b = Date.UTC(+hasta.slice(0, 4), +hasta.slice(5, 7) - 1, +hasta.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
export function sumaDias(fecha: string, dias: number): string {
  const d = new Date(Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10) + dias));
  return d.toISOString().slice(0, 10);
}
export function hoyIso(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function inicioDeMes(fecha: string): string {
  return fecha.slice(0, 8) + "01";
}

// ---------------------------------------------------------------- documentos de venta
export function subtotalDe(lineas: readonly Linea[]): number {
  return suma(lineas.map((l) => r2(l.cantidad * l.precio)));
}
export function impuestoDe(lineas: readonly Linea[], tasa: number): number {
  return r2((subtotalDe(lineas) * tasa) / 100);
}
export function totalDe(lineas: readonly Linea[], tasa: number): number {
  return r2(subtotalDe(lineas) + impuestoDe(lineas, tasa));
}

const aplicadoA = (aps: readonly Aplicacion[], facturaId: string) => suma(aps.filter((a) => a.facturaId === facturaId).map((a) => a.monto));

/** Lo pagado y lo acreditado a una factura, y lo que queda. */
export function saldoDeFactura(f: Factura, pagos: readonly PagoRecibido[], notas: readonly NotaDeCredito[]) {
  const total = totalDe(f.lineas, f.tasa);
  const pagado = suma(pagos.map((p) => aplicadoA(p.aplicado, f.id)));
  const acreditado = suma(notas.map((n) => aplicadoA(n.aplicado, f.id)));
  return { total, pagado, acreditado, saldo: r2(total - pagado - acreditado) };
}

export type EstadoDeFactura = "draft" | "sent" | "partial" | "paid" | "overdue" | "open";

export function estadoDeFactura(f: Factura, saldo: number, total: number, hoy: string): EstadoDeFactura {
  if (f.borrador) return "draft";
  if (saldo <= CASI_CERO) return "paid";
  if (f.vence < hoy) return "overdue";
  if (saldo < total - CASI_CERO) return "partial";
  return f.enviada ? "sent" : "open";
}

/** Lo que de un pago todavía no se ha aplicado a ninguna factura (queda como crédito del cliente). */
export function sinAplicarPago(p: PagoRecibido): number {
  return r2(p.monto - suma(p.aplicado.map((a) => a.monto)));
}
export function sinAplicarNota(n: NotaDeCredito): number {
  return r2(totalDe(n.lineas, n.tasa) - suma(n.aplicado.map((a) => a.monto)));
}

/**
 * Reparte un monto entre facturas abiertas, de la más vieja a la más nueva (lo que hace «recibir pago» si no se elige
 * a mano). Devuelve las aplicaciones y lo que sobra.
 */
export function repartePago(monto: number, abiertas: readonly { id: string; fecha: string; saldo: number }[]): { aplicado: Aplicacion[]; sobra: number } {
  let resto = r2(monto);
  const aplicado: Aplicacion[] = [];
  for (const f of [...abiertas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id))) {
    if (resto <= CASI_CERO) break;
    if (f.saldo <= CASI_CERO) continue;
    const m = r2(Math.min(resto, f.saldo));
    aplicado.push({ facturaId: f.id, monto: m });
    resto = r2(resto - m);
  }
  return { aplicado, sobra: resto };
}

/** Valida aplicaciones: ninguna pasa del saldo de su factura ni la suma del monto disponible. Devuelve el error o null. */
export function validaAplicacion(disponible: number, aplicado: readonly Aplicacion[], saldos: Readonly<Record<string, number>>): "negative" | "over-invoice" | "over-amount" | null {
  for (const a of aplicado) {
    if (a.monto < 0) return "negative";
    if (a.monto > (saldos[a.facturaId] ?? 0) + CASI_CERO) return "over-invoice";
  }
  if (suma(aplicado.map((a) => a.monto)) > disponible + CASI_CERO) return "over-amount";
  return null;
}

// ---------------------------------------------------------------- documentos de compra
export function totalGasto(lineas: readonly LineaDeGasto[]): number {
  return suma(lineas.map((l) => l.monto));
}
export function saldoDeFacturaProv(b: FacturaProveedor, pagos: readonly PagoAProveedor[], creditos: readonly CreditoDeProveedor[]) {
  const total = totalGasto(b.lineas);
  const pagado = suma(pagos.flatMap((p) => p.aplicado.filter((a) => a.facturaId === b.id).map((a) => a.monto)));
  const acreditado = suma(creditos.flatMap((c) => c.aplicado.filter((a) => a.facturaId === b.id).map((a) => a.monto)));
  return { total, pagado, acreditado, saldo: r2(total - pagado - acreditado) };
}
export function totalPagoProv(p: PagoAProveedor): number {
  return suma(p.aplicado.map((a) => a.monto));
}
export function sinAplicarCreditoProv(c: CreditoDeProveedor): number {
  return r2(totalGasto(c.lineas) - suma(c.aplicado.map((a) => a.monto)));
}

// ---------------------------------------------------------------- libro mayor
type Mov = { cuentaId: string; debe: number; haber: number; memo?: string };

function renglones(tipo: RenglonDeLibro["tipo"], docId: string, fecha: string, nombre: string, memo: string, movs: Mov[]): RenglonDeLibro[] {
  return movs
    .filter((m) => Math.abs(m.debe) > CASI_CERO || Math.abs(m.haber) > CASI_CERO)
    .map((m, i) => ({
      clave: `${tipo}:${docId}:${i}`, origen: `${tipo}:${docId}`, tipo, docId, fecha, cuentaId: m.cuentaId,
      debe: r2(m.debe), haber: r2(m.haber), nombre, memo: m.memo ?? memo,
    }));
}

export function asientoDeFactura(f: Factura, articulos: EstadoQbo["articulos"], nombre: string): RenglonDeLibro[] {
  if (f.borrador) return [];
  const porCuenta = new Map<string, number>();
  let costo = 0;
  for (const l of f.lineas) {
    const art = articulos.find((a) => a.id === l.articuloId);
    const cta = art?.cuentaIngreso ?? "a-4000";
    porCuenta.set(cta, r2((porCuenta.get(cta) ?? 0) + r2(l.cantidad * l.precio)));
    if (art?.inventario) costo = r2(costo + r2(l.cantidad * art.costo));
  }
  const movs: Mov[] = [
    { cuentaId: CTA.porCobrar, debe: totalDe(f.lineas, f.tasa), haber: 0 },
    ...[...porCuenta].map(([cuentaId, m]) => ({ cuentaId, debe: 0, haber: m })),
    { cuentaId: CTA.impuestos, debe: 0, haber: impuestoDe(f.lineas, f.tasa) },
    { cuentaId: CTA.costoVendido, debe: costo, haber: 0, memo: "Cost of tile sold" },
    { cuentaId: CTA.inventario, debe: 0, haber: costo, memo: "Cost of tile sold" },
  ];
  return renglones("invoice", f.id, f.fecha, nombre, `Invoice ${f.numero}`, movs);
}

export function asientoDePago(p: PagoRecibido, nombre: string): RenglonDeLibro[] {
  return renglones("payment", p.id, p.fecha, nombre, `Payment ${p.numero}`, [
    { cuentaId: p.cuentaBanco, debe: p.monto, haber: 0 },
    { cuentaId: CTA.porCobrar, debe: 0, haber: p.monto },
  ]);
}

export function asientoDeNota(n: NotaDeCredito, articulos: EstadoQbo["articulos"], nombre: string): RenglonDeLibro[] {
  const porCuenta = new Map<string, number>();
  for (const l of n.lineas) {
    const cta = articulos.find((a) => a.id === l.articuloId)?.cuentaIngreso ?? "a-4000";
    porCuenta.set(cta, r2((porCuenta.get(cta) ?? 0) + r2(l.cantidad * l.precio)));
  }
  return renglones("credit", n.id, n.fecha, nombre, `Credit memo ${n.numero}`, [
    ...[...porCuenta].map(([cuentaId, m]) => ({ cuentaId, debe: m, haber: 0 })),
    { cuentaId: CTA.impuestos, debe: impuestoDe(n.lineas, n.tasa), haber: 0 },
    { cuentaId: CTA.porCobrar, debe: 0, haber: totalDe(n.lineas, n.tasa) },
  ]);
}

export function asientoDeFacturaProv(b: FacturaProveedor, nombre: string): RenglonDeLibro[] {
  return renglones("bill", b.id, b.fecha, nombre, `Bill ${b.numero}`, [
    ...b.lineas.map((l) => ({ cuentaId: l.cuentaId, debe: l.monto, haber: 0, memo: l.descripcion })),
    { cuentaId: CTA.porPagar, debe: 0, haber: totalGasto(b.lineas) },
  ]);
}

export function asientoDePagoProv(p: PagoAProveedor, nombre: string): RenglonDeLibro[] {
  const t = totalPagoProv(p);
  return renglones("billPayment", p.id, p.fecha, nombre, `Bill payment ${p.numero}`, [
    { cuentaId: CTA.porPagar, debe: t, haber: 0 },
    { cuentaId: p.cuentaBanco, debe: 0, haber: t },
  ]);
}

export function asientoDeCreditoProv(c: CreditoDeProveedor, nombre: string): RenglonDeLibro[] {
  return renglones("vendorCredit", c.id, c.fecha, nombre, `Vendor credit ${c.numero}`, [
    { cuentaId: CTA.porPagar, debe: totalGasto(c.lineas), haber: 0 },
    ...c.lineas.map((l) => ({ cuentaId: l.cuentaId, debe: 0, haber: l.monto, memo: l.descripcion })),
  ]);
}

export function asientoManualBalanceado(lineas: readonly LineaDeAsiento[]): { debe: number; haber: number; cuadra: boolean } {
  const debe = suma(lineas.map((l) => l.debe || 0));
  const haber = suma(lineas.map((l) => l.haber || 0));
  return { debe, haber, cuadra: debe > 0 && Math.abs(debe - haber) < CASI_CERO };
}

/** Todos los renglones del libro, de todos los documentos, en orden de fecha. */
export function libroMayor(e: EstadoQbo): RenglonDeLibro[] {
  const cli = (id: string) => e.clientes.find((c) => c.id === id)?.nombre ?? "";
  const prov = (id: string) => e.proveedores.find((p) => p.id === id)?.nombre ?? "";
  const out: RenglonDeLibro[] = [
    ...e.facturas.flatMap((f) => asientoDeFactura(f, e.articulos, cli(f.clienteId))),
    ...e.pagos.flatMap((p) => asientoDePago(p, cli(p.clienteId))),
    ...e.notas.flatMap((n) => asientoDeNota(n, e.articulos, cli(n.clienteId))),
    ...e.facturasProv.flatMap((b) => asientoDeFacturaProv(b, prov(b.proveedorId))),
    ...e.pagosProv.flatMap((p) => asientoDePagoProv(p, prov(p.proveedorId))),
    ...e.creditosProv.flatMap((c) => asientoDeCreditoProv(c, prov(c.proveedorId))),
    ...e.asientos.flatMap((a) => renglones("journal", a.id, a.fecha, "", a.memo || `Journal ${a.numero}`, a.lineas.map((l) => ({ ...l, memo: l.nota })))),
    ...e.movimientos.flatMap((m) => {
      if (m.estado !== "categorized" || !m.categoriaId) return [];
      const banco = e.bancos.find((b) => b.id === m.bancoId);
      if (!banco) return [];
      const v = Math.abs(m.monto);
      return renglones("bankTx", m.id, m.fecha, "", m.descripcion, m.monto >= 0
        ? [{ cuentaId: banco.cuentaId, debe: v, haber: 0 }, { cuentaId: m.categoriaId, debe: 0, haber: v }]
        : [{ cuentaId: m.categoriaId, debe: v, haber: 0 }, { cuentaId: banco.cuentaId, debe: 0, haber: v }]);
    }),
  ];
  return out.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave));
}

/** Cada documento cuadra por sí mismo (debe = haber). Devuelve los orígenes que no cuadran. */
export function documentosDescuadrados(libro: readonly RenglonDeLibro[]): string[] {
  const m = new Map<string, number>();
  for (const r of libro) m.set(r.origen, r2((m.get(r.origen) ?? 0) + r.debe - r.haber));
  return [...m].filter(([, v]) => Math.abs(v) > CASI_CERO).map(([k]) => k);
}

const SALDO_DEUDOR: ReadonlySet<TipoDeCuenta> = new Set(["bank", "ar", "asset", "cogs", "expense"]);
export const esDeudora = (t: TipoDeCuenta) => SALDO_DEUDOR.has(t);

/** Saldo de una cuenta con su signo natural (activos y gastos: debe − haber; el resto: haber − debe). */
export function saldoDeCuenta(cuenta: Cuenta, libro: readonly RenglonDeLibro[], desde?: string, hasta?: string): number {
  let d = 0, h = 0;
  for (const r of libro) {
    if (r.cuentaId !== cuenta.id) continue;
    if (desde && r.fecha < desde) continue;
    if (hasta && r.fecha > hasta) continue;
    d += r.debe; h += r.haber;
  }
  return r2(esDeudora(cuenta.tipo) ? d - h : h - d);
}

// ---------------------------------------------------------------- informes
export interface LineaDeInforme { cuentaId: string; nombre_en: string; nombre_es: string; monto: number }

export function estadoDeResultados(e: EstadoQbo, libro: readonly RenglonDeLibro[], desde: string, hasta: string) {
  const de = (tipos: TipoDeCuenta[]): LineaDeInforme[] => e.cuentas.filter((c) => tipos.includes(c.tipo))
    .map((c) => ({ cuentaId: c.id, nombre_en: c.nombre_en, nombre_es: c.nombre_es, monto: saldoDeCuenta(c, libro, desde, hasta) }))
    .filter((l) => Math.abs(l.monto) > CASI_CERO);
  const ingresos = de(["income"]);
  const costo = de(["cogs"]);
  const gastos = de(["expense"]);
  const totalIngresos = suma(ingresos.map((l) => l.monto));
  const totalCosto = suma(costo.map((l) => l.monto));
  const totalGastos = suma(gastos.map((l) => l.monto));
  const bruta = r2(totalIngresos - totalCosto);
  return { ingresos, costo, gastos, totalIngresos, totalCosto, bruta, totalGastos, neta: r2(bruta - totalGastos) };
}

export function balanceGeneral(e: EstadoQbo, libro: readonly RenglonDeLibro[], hasta: string) {
  const de = (tipos: TipoDeCuenta[]): LineaDeInforme[] => e.cuentas.filter((c) => tipos.includes(c.tipo))
    .map((c) => ({ cuentaId: c.id, nombre_en: c.nombre_en, nombre_es: c.nombre_es, monto: saldoDeCuenta(c, libro, undefined, hasta) }))
    .filter((l) => Math.abs(l.monto) > CASI_CERO);
  const activos = de(["bank", "ar", "asset"]);
  const pasivos = de(["ap", "liability"]);
  const capital = de(["equity"]);
  const utilidad = estadoDeResultados(e, libro, "0000-01-01", hasta).neta;
  const totalActivos = suma(activos.map((l) => l.monto));
  const totalPasivos = suma(pasivos.map((l) => l.monto));
  const totalCapital = r2(suma(capital.map((l) => l.monto)) + utilidad);
  return { activos, pasivos, capital, utilidad, totalActivos, totalPasivos, totalCapital, cuadra: Math.abs(totalActivos - totalPasivos - totalCapital) < 0.01 };
}

export type Tramo = "current" | "d1_30" | "d31_60" | "d61_90" | "d90";
export const TRAMOS: Tramo[] = ["current", "d1_30", "d31_60", "d61_90", "d90"];

export function tramoDe(vence: string, hoy: string): Tramo {
  const d = diasEntre(vence, hoy);
  if (d <= 0) return "current";
  if (d <= 30) return "d1_30";
  if (d <= 60) return "d31_60";
  if (d <= 90) return "d61_90";
  return "d90";
}

export interface FilaDeAntiguedad { id: string; nombre: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90: number; total: number }

function antiguedad(docs: { quien: string; vence: string; saldo: number }[], nombres: Map<string, string>, hoy: string): FilaDeAntiguedad[] {
  const filas = new Map<string, FilaDeAntiguedad>();
  for (const d of docs) {
    if (Math.abs(d.saldo) <= CASI_CERO) continue;
    const f = filas.get(d.quien) ?? { id: d.quien, nombre: nombres.get(d.quien) ?? d.quien, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0, total: 0 };
    const t = tramoDe(d.vence, hoy);
    f[t] = r2(f[t] + d.saldo);
    f.total = r2(f.total + d.saldo);
    filas.set(d.quien, f);
  }
  return [...filas.values()].filter((f) => Math.abs(f.total) > CASI_CERO || TRAMOS.some((t) => Math.abs(f[t]) > CASI_CERO)).sort((a, b) => b.total - a.total);
}

/** Facturas con su saldo y estado, calculados una vez. */
export function facturasConSaldo(e: EstadoQbo, hoy: string) {
  return e.facturas.map((f) => {
    const s = saldoDeFactura(f, e.pagos, e.notas);
    return { factura: f, ...s, estado: estadoDeFactura(f, s.saldo, s.total, hoy) };
  });
}

export type EstadoDeFacturaProv = "paid" | "partial" | "overdue" | "open";
export function facturasProvConSaldo(e: EstadoQbo, hoy: string) {
  return e.facturasProv.map((b) => {
    const s = saldoDeFacturaProv(b, e.pagosProv, e.creditosProv);
    const estado: EstadoDeFacturaProv = s.saldo <= CASI_CERO ? "paid" : b.vence < hoy ? "overdue" : s.pagado + s.acreditado > CASI_CERO ? "partial" : "open";
    return { factura: b, ...s, estado };
  });
}

export function antiguedadPorCobrar(e: EstadoQbo, hoy: string): FilaDeAntiguedad[] {
  const docs = facturasConSaldo(e, hoy).filter((x) => !x.factura.borrador).map((x) => ({ quien: x.factura.clienteId, vence: x.factura.vence, saldo: x.saldo }));
  // Pagos y notas sin aplicar: crédito del cliente, en «al corriente», en negativo.
  for (const p of e.pagos) docs.push({ quien: p.clienteId, vence: hoy, saldo: -sinAplicarPago(p) });
  for (const n of e.notas) docs.push({ quien: n.clienteId, vence: hoy, saldo: -sinAplicarNota(n) });
  return antiguedad(docs, new Map(e.clientes.map((c) => [c.id, c.nombre])), hoy);
}

export function antiguedadPorPagar(e: EstadoQbo, hoy: string): FilaDeAntiguedad[] {
  const docs = facturasProvConSaldo(e, hoy).map((x) => ({ quien: x.factura.proveedorId, vence: x.factura.vence, saldo: x.saldo }));
  for (const c of e.creditosProv) docs.push({ quien: c.proveedorId, vence: hoy, saldo: -sinAplicarCreditoProv(c) });
  return antiguedad(docs, new Map(e.proveedores.map((p) => [p.id, p.nombre])), hoy);
}

/** Saldo de cada cliente = facturas abiertas − pagos y notas sin aplicar. Cuadra con la cuenta «por cobrar». */
export function saldoDeCliente(e: EstadoQbo, clienteId: string): number {
  const abiertas = e.facturas.filter((f) => f.clienteId === clienteId && !f.borrador).map((f) => saldoDeFactura(f, e.pagos, e.notas).saldo);
  const pagos = e.pagos.filter((p) => p.clienteId === clienteId).map(sinAplicarPago);
  const notas = e.notas.filter((n) => n.clienteId === clienteId).map(sinAplicarNota);
  return r2(suma(abiertas) - suma(pagos) - suma(notas));
}

export function saldoDeProveedor(e: EstadoQbo, proveedorId: string): number {
  const abiertas = e.facturasProv.filter((b) => b.proveedorId === proveedorId).map((b) => saldoDeFacturaProv(b, e.pagosProv, e.creditosProv).saldo);
  const creditos = e.creditosProv.filter((c) => c.proveedorId === proveedorId).map(sinAplicarCreditoProv);
  return r2(suma(abiertas) - suma(creditos));
}

export function ventasPorCliente(e: EstadoQbo, desde: string, hasta: string) {
  const m = new Map<string, number>();
  for (const f of e.facturas) if (!f.borrador && f.fecha >= desde && f.fecha <= hasta) m.set(f.clienteId, r2((m.get(f.clienteId) ?? 0) + subtotalDe(f.lineas)));
  for (const n of e.notas) if (n.fecha >= desde && n.fecha <= hasta) m.set(n.clienteId, r2((m.get(n.clienteId) ?? 0) - subtotalDe(n.lineas)));
  return [...m].map(([id, monto]) => ({ id, nombre: e.clientes.find((c) => c.id === id)?.nombre ?? id, monto })).sort((a, b) => b.monto - a.monto);
}

export function ventasPorArticulo(e: EstadoQbo, desde: string, hasta: string) {
  const m = new Map<string, { cantidad: number; monto: number }>();
  const suma1 = (l: Linea, signo: number) => {
    const x = m.get(l.articuloId) ?? { cantidad: 0, monto: 0 };
    m.set(l.articuloId, { cantidad: r2(x.cantidad + signo * l.cantidad), monto: r2(x.monto + signo * r2(l.cantidad * l.precio)) });
  };
  for (const f of e.facturas) if (!f.borrador && f.fecha >= desde && f.fecha <= hasta) f.lineas.forEach((l) => suma1(l, 1));
  for (const n of e.notas) if (n.fecha >= desde && n.fecha <= hasta) n.lineas.forEach((l) => suma1(l, -1));
  return [...m].map(([id, x]) => {
    const a = e.articulos.find((y) => y.id === id);
    return { id, sku: a?.sku ?? "", nombre: a?.nombre ?? id, ...x };
  }).sort((a, b) => b.monto - a.monto);
}

// ---------------------------------------------------------------- banco
/** Saldo según el banco (feed): saldo inicial + movimientos importados. */
export function saldoSegunBanco(e: EstadoQbo, bancoId: string): number {
  const b = e.bancos.find((x) => x.id === bancoId);
  if (!b) return 0;
  return r2(b.saldoInicialBanco + suma(e.movimientos.filter((m) => m.bancoId === bancoId).map((m) => m.monto)));
}

/** Los renglones del libro que tocan la cuenta del banco, con su efecto (+ entra, − sale). */
export function registroDelBanco(libro: readonly RenglonDeLibro[], cuentaId: string) {
  return libro.filter((r) => r.cuentaId === cuentaId).map((r) => ({ ...r, efecto: r2(r.debe - r.haber) }));
}

/** Candidatos para emparejar un movimiento del banco con un pago ya registrado: mismo monto, ±10 días, aún sin pareja. */
export function candidatosDeEnlace(e: EstadoQbo, movId: string) {
  const m = e.movimientos.find((x) => x.id === movId);
  if (!m) return [];
  const usados = new Set(e.movimientos.filter((x) => x.enlace && x.id !== movId).map((x) => `${x.enlace!.tipo}:${x.enlace!.id}`));
  const cerca = (f: string) => Math.abs(diasEntre(f, m.fecha)) <= 10;
  if (m.monto > 0) {
    return e.pagos.filter((p) => Math.abs(p.monto - m.monto) < CASI_CERO && cerca(p.fecha) && !usados.has(`payment:${p.id}`))
      .map((p) => ({ tipo: "payment" as const, id: p.id, fecha: p.fecha, monto: p.monto, nombre: e.clientes.find((c) => c.id === p.clienteId)?.nombre ?? "", numero: p.numero }));
  }
  return e.pagosProv.filter((p) => Math.abs(totalPagoProv(p) + m.monto) < CASI_CERO && cerca(p.fecha) && !usados.has(`billPayment:${p.id}`))
    .map((p) => ({ tipo: "billPayment" as const, id: p.id, fecha: p.fecha, monto: -totalPagoProv(p), nombre: e.proveedores.find((v) => v.id === p.proveedorId)?.nombre ?? "", numero: p.numero }));
}

/** La primera regla cuya palabra aparece en la descripción (sin distinguir mayúsculas). */
export function reglaQueAplica(reglas: EstadoQbo["reglas"], descripcion: string) {
  const d = descripcion.toLowerCase();
  return reglas.find((r) => r.contiene.trim() && d.includes(r.contiene.trim().toLowerCase())) ?? null;
}

/**
 * Conciliar: saldo inicial (lo ya conciliado) + lo marcado ahora = saldo despejado; la diferencia con el saldo del
 * estado de cuenta debe llegar a 0 para poder terminar.
 */
export function cuentaDeConciliacion(registro: readonly { clave: string; efecto: number }[], yaConciliados: ReadonlySet<string>, marcados: ReadonlySet<string>, saldoFinal: number) {
  const inicial = suma(registro.filter((r) => yaConciliados.has(r.clave)).map((r) => r.efecto));
  const marcado = suma(registro.filter((r) => !yaConciliados.has(r.clave) && marcados.has(r.clave)).map((r) => r.efecto));
  const despejado = r2(inicial + marcado);
  return { inicial, marcado, despejado, diferencia: r2(saldoFinal - despejado) };
}

// ---------------------------------------------------------------- compras
export type EstadoDeOrden = "draft" | "open" | "partial" | "received" | "closed";
export function estadoDeOrden(o: { enviada: boolean; cerrada: boolean; lineas: { cantidad: number; recibido: number; facturado: number }[] }): EstadoDeOrden {
  if (o.cerrada) return "closed";
  if (!o.enviada) return "draft";
  const pedido = o.lineas.reduce((a, l) => a + l.cantidad, 0);
  const recibido = o.lineas.reduce((a, l) => a + l.recibido, 0);
  if (recibido <= 0) return "open";
  if (recibido < pedido) return "partial";
  const facturado = o.lineas.reduce((a, l) => a + l.facturado, 0);
  return facturado >= pedido ? "closed" : "received";
}
export function totalDeOrden(o: { lineas: { cantidad: number; costo: number }[] }): number {
  return suma(o.lineas.map((l) => r2(l.cantidad * l.costo)));
}
/** Lo recibido que aún no se ha facturado: las líneas de la factura que nace de la orden. */
export function porFacturarDeOrden(o: { lineas: { articuloId: string; recibido: number; facturado: number; costo: number }[] }) {
  return o.lineas.filter((l) => l.recibido > l.facturado).map((l) => ({ articuloId: l.articuloId, cantidad: l.recibido - l.facturado, monto: r2((l.recibido - l.facturado) * l.costo) }));
}
