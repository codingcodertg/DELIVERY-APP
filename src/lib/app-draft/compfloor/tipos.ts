/**
 * App Draft · Comp Floor: los tipos del prototipo (distribuidor de piso/azulejo). Todo vive en el navegador; nada toca
 * la base. Las cantidades de stock se guardan SIEMPRE en cajas; pies² y piezas se derivan con las conversiones.
 */
export type Tienda = "mca" | "mis" | "edi" | "wes" | "bro";
export const TIENDAS: readonly Tienda[] = ["mca", "mis", "edi", "wes", "bro"];
export const NOMBRE_TIENDA: Record<Tienda, string> = { mca: "McAllen", mis: "Mission", edi: "Edinburg", wes: "Weslaco", bro: "Brownsville" };

export type Unidad = "box" | "sqft" | "pc";
export type TipoCliente = "retail" | "contractor" | "dealer";

export interface Articulo {
  id: string;
  sku: string;
  nombre: string;
  /** Pies² que trae una caja (0 si el artículo no se mide por área: boquilla, adhesivo…). */
  sqftPorCaja: number;
  piezasPorCaja: number;
  /** Unidad en que se le habla al cliente por omisión. */
  unidadVenta: Unidad;
  /** Precio de lista (menudeo) por caja. */
  precioCaja: number;
  costoCaja: number;
  proveedorId: string;
}

/** Un renglón de stock: un artículo, en una tienda, de un lote y tono, en un bin. */
export interface Existencia {
  id: string;
  articuloId: string;
  tienda: Tienda;
  lote: string;
  tono: string;
  bin: string;
  cajas: number;
  /** Si es remanente / lote suelto: % de descuento sobre el precio. */
  remanentePct: number | null;
  /** Apartado para un cliente (pedido especial recibido): no se ofrece a otros. */
  apartadoPara?: string | null;
}

export interface Cliente {
  id: string;
  nombre: string;
  tipo: TipoCliente;
  telefono: string;
  /** Cuenta abierta (instaladores): límite y lo que debe hoy. null = solo contado. */
  limite: number | null;
  saldo: number;
}

export interface Proveedor { id: string; nombre: string }

/** Precio por tipo de cliente: % de descuento sobre lista, o precio fijo por artículo (gana el fijo si existe). */
export interface NivelDePrecio { tipo: TipoCliente; descuentoPct: number; fijos: Record<string, number> }

export interface LineaPedido {
  id: string;
  articuloId: string;
  cajas: number;
  precioCaja: number;
  /** De qué renglón de stock (lote) se aparta. null = todavía sin lote. */
  existenciaId: string | null;
  reservadas: number;
  enviadas: number;
  /** Si es pedido especial: la orden al proveedor que lo surte. */
  ocId?: string | null;
}

export type EtapaPedido = "quote" | "order" | "closed";

export interface Pedido {
  id: string;
  numero: string;
  clienteId: string;
  tienda: Tienda;
  fecha: string;
  /** 1 = urgente, 2 = normal, 3 = cuando haya. */
  prioridad: 1 | 2 | 3;
  etapa: EtapaPedido;
  lineas: LineaPedido[];
}

/** Lo enviado de un pedido, ya «facturado»: aquí solo es un estado; la contabilidad está en el prototipo de QuickBooks Online. */
export interface Envio {
  id: string;
  numero: string;
  pedidoId: string;
  fecha: string;
  total: number;
  lineas: { articuloId: string; existenciaId: string | null; cajas: number; precioCaja: number }[];
}

export type Pago = "cash" | "card" | "account";
export interface VentaMostrador {
  id: string;
  numero: string;
  clienteId: string | null;
  tienda: Tienda;
  fecha: string;
  pago: Pago;
  lineas: { articuloId: string; existenciaId: string; cajas: number; precioCaja: number }[];
  total: number;
}

export interface OrdenEspecial {
  id: string;
  numero: string;
  proveedorId: string;
  articuloId: string;
  cajas: number;
  pedidoId: string;
  lineaId: string;
  fecha: string;
  recibida: boolean;
}

export interface Alerta { id: string; fecha: string; pedidoId: string; en: string; es: string; leida: boolean }

export interface Traslado {
  id: string;
  numero: string;
  existenciaOrigenId: string;
  articuloId: string;
  lote: string;
  tono: string;
  desde: Tienda;
  hacia: Tienda;
  binDestino: string;
  cajas: number;
  fecha: string;
  recibido: boolean;
}

export interface EstadoCf {
  version: 1;
  articulos: Articulo[];
  existencias: Existencia[];
  clientes: Cliente[];
  proveedores: Proveedor[];
  niveles: NivelDePrecio[];
  bins: Record<Tienda, string[]>;
  pedidos: Pedido[];
  envios: Envio[];
  ventas: VentaMostrador[];
  especiales: OrdenEspecial[];
  alertas: Alerta[];
  traslados: Traslado[];
}
