/**
 * App Draft · QuickBooks Online: el reductor del estado (puro). La pantalla le manda acciones; cada documento nuevo
 * llega ya armado y validado por la pantalla con las funciones de `contabilidad.ts`. El libro mayor NO se guarda: se
 * deriva siempre de los documentos (`libroMayor`), así que no puede descuadrarse.
 */
import { porFacturarDeOrden, reglaQueAplica, r2, sumaDias } from "./contabilidad";
import { generarMuestra } from "./muestra";
import type {
  AsientoManual, Aplicacion, Cliente, CreditoDeProveedor, EstadoQbo, Factura, FacturaProveedor, MovimientoBancario,
  NotaDeCredito, OrdenDeCompra, PagoAProveedor, PagoRecibido, Proveedor, Regla,
} from "./tipos";

export type AccionQbo =
  | { tipo: "reset"; hoy: string }
  | { tipo: "cargar"; estado: EstadoQbo }
  | { tipo: "guardarCliente"; cliente: Cliente }
  | { tipo: "guardarProveedor"; proveedor: Proveedor }
  | { tipo: "guardarFactura"; factura: Factura }
  | { tipo: "borrarFactura"; id: string }
  | { tipo: "recibirPago"; pago: PagoRecibido }
  | { tipo: "guardarNota"; nota: NotaDeCredito }
  | { tipo: "aplicarNota"; id: string; aplicado: Aplicacion[] }
  | { tipo: "guardarFacturaProv"; factura: FacturaProveedor }
  | { tipo: "pagarProveedor"; pago: PagoAProveedor }
  | { tipo: "guardarCreditoProv"; credito: CreditoDeProveedor }
  | { tipo: "guardarOrden"; orden: OrdenDeCompra }
  | { tipo: "recibirOrden"; id: string; cantidades: Record<string, number> }
  | { tipo: "facturarOrden"; id: string; billId: string; numero: string; fecha: string }
  | { tipo: "cerrarOrden"; id: string }
  | { tipo: "categorizar"; id: string; cuentaId: string }
  | { tipo: "enlazar"; id: string; enlace: NonNullable<MovimientoBancario["enlace"]> }
  | { tipo: "excluir"; id: string }
  | { tipo: "deshacerMovimiento"; id: string }
  | { tipo: "guardarRegla"; regla: Regla }
  | { tipo: "borrarRegla"; id: string }
  | { tipo: "aplicarReglas" }
  | { tipo: "guardarAsiento"; asiento: AsientoManual }
  | { tipo: "conciliar"; bancoId: string; fechaCorte: string; saldoFinal: number; claves: string[]; id: string; hecha: string };

function upsert<T extends { id: string }>(xs: readonly T[], x: T): T[] {
  return xs.some((y) => y.id === x.id) ? xs.map((y) => (y.id === x.id ? x : y)) : [...xs, x];
}

export function reductorQbo(e: EstadoQbo, a: AccionQbo): EstadoQbo {
  switch (a.tipo) {
    case "reset": return generarMuestra(a.hoy);
    case "cargar": return a.estado;
    case "guardarCliente": return { ...e, clientes: upsert(e.clientes, a.cliente) };
    case "guardarProveedor": return { ...e, proveedores: upsert(e.proveedores, a.proveedor) };
    case "guardarFactura": return { ...e, facturas: upsert(e.facturas, a.factura) };
    case "borrarFactura": {
      const f = e.facturas.find((x) => x.id === a.id);
      if (!f || !f.borrador) return e;
      return { ...e, facturas: e.facturas.filter((x) => x.id !== a.id) };
    }
    case "recibirPago": return { ...e, pagos: upsert(e.pagos, a.pago) };
    case "guardarNota": return { ...e, notas: upsert(e.notas, a.nota) };
    case "aplicarNota": return { ...e, notas: e.notas.map((n) => (n.id === a.id ? { ...n, aplicado: [...n.aplicado, ...a.aplicado] } : n)) };
    case "guardarFacturaProv": return { ...e, facturasProv: upsert(e.facturasProv, a.factura) };
    case "pagarProveedor": return { ...e, pagosProv: upsert(e.pagosProv, a.pago) };
    case "guardarCreditoProv": return { ...e, creditosProv: upsert(e.creditosProv, a.credito) };
    case "guardarOrden": return { ...e, ordenes: upsert(e.ordenes, a.orden) };
    case "recibirOrden":
      return {
        ...e,
        ordenes: e.ordenes.map((o) => o.id !== a.id ? o : {
          ...o, enviada: true,
          lineas: o.lineas.map((l) => ({ ...l, recibido: Math.min(l.cantidad, l.recibido + Math.max(0, a.cantidades[l.articuloId] ?? 0)) })),
        }),
      };
    case "facturarOrden": {
      const o = e.ordenes.find((x) => x.id === a.id);
      if (!o) return e;
      const pend = porFacturarDeOrden(o);
      if (!pend.length) return e;
      const prov = e.proveedores.find((p) => p.id === o.proveedorId);
      const bill: FacturaProveedor = {
        id: a.billId, numero: a.numero, proveedorId: o.proveedorId, fecha: a.fecha, vence: sumaDias(a.fecha, prov?.plazo ?? 30),
        ordenId: o.id, nota: `From ${o.numero}`,
        lineas: pend.map((p) => ({ cuentaId: "a-1300", descripcion: e.articulos.find((x) => x.id === p.articuloId)?.nombre ?? p.articuloId, monto: p.monto, articuloId: p.articuloId, cantidad: p.cantidad })),
      };
      return {
        ...e,
        facturasProv: [...e.facturasProv, bill],
        ordenes: e.ordenes.map((x) => x.id !== o.id ? x : { ...x, lineas: x.lineas.map((l) => ({ ...l, facturado: l.recibido })) }),
      };
    }
    case "cerrarOrden": return { ...e, ordenes: e.ordenes.map((o) => (o.id === a.id ? { ...o, cerrada: true } : o)) };
    case "categorizar": return { ...e, movimientos: e.movimientos.map((m) => (m.id === a.id ? { ...m, estado: "categorized", categoriaId: a.cuentaId, enlace: null } : m)) };
    case "enlazar": return { ...e, movimientos: e.movimientos.map((m) => (m.id === a.id ? { ...m, estado: "matched", categoriaId: null, enlace: a.enlace } : m)) };
    case "excluir": return { ...e, movimientos: e.movimientos.map((m) => (m.id === a.id ? { ...m, estado: "excluded", categoriaId: null, enlace: null } : m)) };
    case "deshacerMovimiento": {
      // No se deshace lo ya conciliado: cambiaría un saldo que se dio por bueno.
      if (e.conciliados.some((c) => c.startsWith(`bankTx:${a.id}:`))) return e;
      return { ...e, movimientos: e.movimientos.map((m) => (m.id === a.id ? { ...m, estado: "new", categoriaId: null, enlace: null } : m)) };
    }
    case "guardarRegla": return { ...e, reglas: upsert(e.reglas, a.regla) };
    case "borrarRegla": return { ...e, reglas: e.reglas.filter((r) => r.id !== a.id) };
    case "aplicarReglas":
      return {
        ...e,
        movimientos: e.movimientos.map((m) => {
          if (m.estado !== "new") return m;
          const r = reglaQueAplica(e.reglas, m.descripcion);
          return r ? { ...m, estado: "categorized", categoriaId: r.cuentaId } : m;
        }),
      };
    case "guardarAsiento": return { ...e, asientos: upsert(e.asientos, a.asiento) };
    case "conciliar":
      return {
        ...e,
        conciliados: Array.from(new Set([...e.conciliados, ...a.claves])),
        conciliaciones: [...e.conciliaciones, { id: a.id, bancoId: a.bancoId, fechaCorte: a.fechaCorte, saldoFinal: r2(a.saldoFinal), hecha: a.hecha }],
      };
    default: { const _x: never = a; return _x; }
  }
}

/** El siguiente número de una serie con prefijo («1041», «P-2031»…): uno más que el mayor que exista. */
export function siguienteNumero(existentes: readonly string[], prefijo: string, primero: number): string {
  let max = primero - 1;
  for (const n of existentes) {
    if (!n.startsWith(prefijo)) continue;
    const v = Number(n.slice(prefijo.length));
    if (Number.isFinite(v) && v > max) max = v;
  }
  return `${prefijo}${max + 1}`;
}

export const CLAVE_LOCAL = "rtg:app-draft:qbo:v1";

/** Lee el estado guardado; si no hay, o no se puede leer, devuelve null (y la pantalla genera la muestra). */
export function leerGuardado(): EstadoQbo | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_LOCAL);
    if (!crudo) return null;
    const e = JSON.parse(crudo) as EstadoQbo;
    return e && e.version === 1 && Array.isArray(e.facturas) ? e : null;
  } catch {
    return null;
  }
}

export function guardar(e: EstadoQbo): void {
  try {
    window.localStorage.setItem(CLAVE_LOCAL, JSON.stringify(e));
  } catch {
    // Sin almacenamiento (ventana privada, cuota): el prototipo sigue funcionando en memoria.
  }
}
