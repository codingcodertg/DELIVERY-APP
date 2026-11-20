/**
 * App Draft · QuickBooks Online (prototipo). Las entidades del prototipo de contabilidad, modeladas sobre el modelo de
 * datos inferido de QBO pero con nombres y forma propios. TODO vive en el navegador con datos de ejemplo: nada de esto
 * toca la base.
 *
 * Fechas: texto `YYYY-MM-DD`. Dinero: número en dólares, redondeado a centavos con `r2`.
 */

export type TipoDeCuenta = "bank" | "ar" | "asset" | "ap" | "liability" | "equity" | "income" | "cogs" | "expense";

/** Una cuenta del catálogo de cuentas (chart of accounts). */
export interface Cuenta {
  id: string;
  numero: string;
  nombre_en: string;
  nombre_es: string;
  tipo: TipoDeCuenta;
}

export type TipoDeCliente = "contractor" | "homeowner" | "designer";

export interface Cliente {
  id: string;
  nombre: string;
  empresa: string | null;
  tipo: TipoDeCliente;
  telefono: string;
  email: string;
  tienda: string;
  /** Días para pagar (Net 15, Net 30; 0 = al recibir). */
  plazo: number;
}

export interface Proveedor {
  id: string;
  nombre: string;
  telefono: string;
  email: string;
  plazo: number;
  /** Cuenta por defecto de sus facturas (inventario o un gasto). */
  cuentaPorDefecto: string;
}

export interface Articulo {
  id: string;
  sku: string;
  nombre: string;
  unidad: string;
  precio: number;
  costo: number;
  /** Inventario: al venderlo mueve el costo a «costo de lo vendido». Servicio: no. */
  inventario: boolean;
  cuentaIngreso: string;
  proveedorId: string | null;
}

export interface Linea {
  articuloId: string;
  descripcion: string;
  cantidad: number;
  precio: number;
}

export interface Aplicacion {
  facturaId: string;
  monto: number;
}

export interface Factura {
  id: string;
  numero: string;
  clienteId: string;
  tienda: string;
  fecha: string;
  vence: string;
  lineas: Linea[];
  /** % de impuesto (8.25, o 6.25 en Mission: `tasaDeImpuesto` del Quote Builder). */
  tasa: number;
  borrador: boolean;
  enviada: boolean;
  nota: string;
}

export interface PagoRecibido {
  id: string;
  numero: string;
  clienteId: string;
  fecha: string;
  monto: number;
  metodo: "check" | "card" | "cash" | "transfer";
  referencia: string;
  cuentaBanco: string;
  aplicado: Aplicacion[];
}

export interface NotaDeCredito {
  id: string;
  numero: string;
  clienteId: string;
  fecha: string;
  lineas: Linea[];
  tasa: number;
  motivo: string;
  aplicado: Aplicacion[];
}

export interface LineaDeGasto {
  cuentaId: string;
  descripcion: string;
  monto: number;
  articuloId?: string;
  cantidad?: number;
}

export interface FacturaProveedor {
  id: string;
  numero: string;
  proveedorId: string;
  fecha: string;
  vence: string;
  lineas: LineaDeGasto[];
  ordenId: string | null;
  nota: string;
}

export interface AplicacionAProveedor {
  facturaId: string;
  monto: number;
}

export interface PagoAProveedor {
  id: string;
  numero: string;
  proveedorId: string;
  fecha: string;
  cuentaBanco: string;
  metodo: "check" | "ach" | "card";
  aplicado: AplicacionAProveedor[];
}

export interface CreditoDeProveedor {
  id: string;
  numero: string;
  proveedorId: string;
  fecha: string;
  lineas: LineaDeGasto[];
  motivo: string;
  aplicado: AplicacionAProveedor[];
}

export interface LineaDeOrden {
  articuloId: string;
  cantidad: number;
  costo: number;
  recibido: number;
  facturado: number;
}

export interface OrdenDeCompra {
  id: string;
  numero: string;
  proveedorId: string;
  fecha: string;
  esperada: string;
  lineas: LineaDeOrden[];
  /** Borrador hasta que se manda; cerrada a mano o cuando todo se recibió y facturó. */
  enviada: boolean;
  cerrada: boolean;
}

export interface CuentaBancaria {
  id: string;
  nombre: string;
  ultimos4: string;
  /** La cuenta del catálogo que la representa en los libros. */
  cuentaId: string;
  /** Saldo del banco antes del primer movimiento del «feed». */
  saldoInicialBanco: number;
}

export interface MovimientoBancario {
  id: string;
  bancoId: string;
  fecha: string;
  descripcion: string;
  /** Positivo entra, negativo sale. */
  monto: number;
  estado: "new" | "categorized" | "matched" | "excluded";
  categoriaId: string | null;
  enlace: { tipo: "payment" | "billPayment"; id: string } | null;
}

export interface Regla {
  id: string;
  contiene: string;
  cuentaId: string;
}

export interface LineaDeAsiento {
  cuentaId: string;
  debe: number;
  haber: number;
  nota?: string;
}

export interface AsientoManual {
  id: string;
  numero: string;
  fecha: string;
  memo: string;
  lineas: LineaDeAsiento[];
}

export interface Conciliacion {
  id: string;
  bancoId: string;
  fechaCorte: string;
  saldoFinal: number;
  hecha: string;
}

export interface EstadoQbo {
  version: 1;
  generado: string;
  cuentas: Cuenta[];
  clientes: Cliente[];
  proveedores: Proveedor[];
  articulos: Articulo[];
  facturas: Factura[];
  pagos: PagoRecibido[];
  notas: NotaDeCredito[];
  facturasProv: FacturaProveedor[];
  pagosProv: PagoAProveedor[];
  creditosProv: CreditoDeProveedor[];
  ordenes: OrdenDeCompra[];
  bancos: CuentaBancaria[];
  movimientos: MovimientoBancario[];
  reglas: Regla[];
  asientos: AsientoManual[];
  /** Claves (`origen`) de los renglones de libro del banco ya conciliados. */
  conciliados: string[];
  conciliaciones: Conciliacion[];
}

/** Un renglón del libro mayor, derivado de los documentos por `libroMayor`. */
export interface RenglonDeLibro {
  /** Único por renglón: `<tipo>:<id>:<n>`. */
  clave: string;
  /** El documento que lo generó: `<tipo>:<id>`. */
  origen: string;
  tipo: "invoice" | "payment" | "credit" | "bill" | "billPayment" | "vendorCredit" | "journal" | "bankTx";
  docId: string;
  fecha: string;
  cuentaId: string;
  debe: number;
  haber: number;
  nombre: string;
  memo: string;
}
