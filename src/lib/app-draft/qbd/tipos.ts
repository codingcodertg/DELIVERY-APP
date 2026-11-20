/**
 * App Draft · QuickBooks Desktop (prototipo). SOLO lo que la versión de escritorio tiene y el prototipo de QuickBooks
 * Online no: almacenes y traspasos, ubicaciones (bins), lotes y caducidad, varias unidades de medida, órdenes de venta
 * con surtido, kits, niveles y reglas de precio, costo de importación (landed cost) y proveedores alternos.
 * Clientes, proveedores y artículos se IMPORTAN de la muestra de QBO (`qbo/muestra.ts`), no se copian.
 *
 * Cantidades de existencia: siempre en la UNIDAD BASE del artículo (caja para loseta, bolsa para polvos, pieza para
 * molduras). Fechas: `YYYY-MM-DD`. Todo vive en el navegador con datos de ejemplo.
 */
import type { Articulo, Cliente, OrdenDeCompra, Proveedor, TipoDeCliente } from "../qbo/tipos";

export type Categoria = "tile" | "setting" | "trim" | "kit";

/** Un almacén o tienda donde hay mercancía. */
export interface Sitio {
  id: string;
  nombre: string;
}

/** Una ubicación dentro de un sitio (pasillo-rack-nivel). */
export interface Bin {
  id: string;
  sitioId: string;
  codigo: string;
}

/** Una unidad dentro de un juego: cuántas unidades base vale una de ésta. */
export interface Unidad {
  u: string;
  factor: number;
}

/** Juego de unidades: la base, sus equivalencias y la unidad por defecto en cada pantalla. */
export interface JuegoDeUnidades {
  id: string;
  nombre: string;
  base: string;
  unidades: Unidad[];
  compra: string;
  venta: string;
  envio: string;
}

/** Lo que el escritorio guarda de más por artículo. */
export interface FichaDeArticulo {
  articuloId: string;
  categoria: Categoria;
  juegoId: string;
  /** Polvos y adhesivos: se reciben por lote y con fecha de caducidad. */
  conLote: boolean;
  /** Pedir cuando la existencia total baja de esto (en unidad base). */
  puntoDeReorden: number;
}

/** Un renglón de existencia: artículo × sitio × ubicación × lote. Es la verdad de cuánto hay y dónde. */
export interface Existencia {
  id: string;
  articuloId: string;
  sitioId: string;
  /** null = en el andén, todavía sin acomodar. */
  binId: string | null;
  lote: string | null;
  caduca: string | null;
  /** Fecha en que entró (para primeras entradas, primeras salidas). */
  recibido: string;
  cantidad: number;
  /** Costo unitario por unidad base. */
  costo: number;
}

export interface LineaDeTraspaso {
  articuloId: string;
  cantidad: number;
  lote: string | null;
  caduca: string | null;
  recibido: string;
  costo: number;
}

export interface Traspaso {
  id: string;
  numero: string;
  origenId: string;
  destinoId: string;
  fecha: string;
  lineas: LineaDeTraspaso[];
  estado: "in_transit" | "received";
  recibidoEl: string | null;
}

export interface LineaDeVenta {
  articuloId: string;
  /** Lo pedido, en unidad base. */
  cantidad: number;
  /** Unidad y cantidad como las escribió el vendedor. */
  unidad: string;
  cantidadEscrita: number;
  /** Precio por unidad base, ya con la regla ganadora. */
  precio: number;
  regla: string;
  /** Ya enviado (en unidad base). */
  enviado: number;
}

export interface OrdenDeVenta {
  id: string;
  numero: string;
  clienteId: string;
  sitioId: string;
  fecha: string;
  lineas: LineaDeVenta[];
  cancelada: boolean;
}

export interface Toma {
  existenciaId: string;
  cantidad: number;
}

export interface LineaDeEnvio {
  articuloId: string;
  cantidad: number;
  /** Lote y ubicación sugeridos (primeras caducidades primero). */
  tomas: Toma[];
  escaneado: number;
}

/** Una lista de surtido → empaque → envío para parte (o todo) de una orden. */
export interface Envio {
  id: string;
  numero: string;
  ordenId: string;
  fecha: string;
  lineas: LineaDeEnvio[];
  /** picking = por surtir (la existencia está apartada); picked = ya salió del estante (se descontó). */
  estado: "picking" | "picked" | "packed" | "shipped";
}

export interface Componente {
  articuloId: string;
  cantidad: number;
}

export interface Kit {
  id: string;
  sku: string;
  nombre: string;
  precio: number;
  componentes: Componente[];
}

export interface Armado {
  id: string;
  kitId: string;
  sitioId: string;
  cantidad: number;
  fecha: string;
  costoUnitario: number;
}

/** Nivel de precio por tipo de cliente: % sobre el precio de lista (negativo = descuento). */
export interface NivelDePrecio {
  tipo: TipoDeCliente;
  porcentaje: number;
}

export interface ReglaDePrecio {
  id: string;
  nombre: string;
  categoria: Categoria | null;
  tipoCliente: TipoDeCliente | null;
  desde: string | null;
  hasta: string | null;
  minimo: number;
  /** % sobre lista (negativo = descuento). */
  porcentaje: number;
  activa: boolean;
}

export interface CostoDeImportacion {
  id: string;
  ordenId: string;
  fecha: string;
  flete: number;
  arancel: number;
  metodo: "value" | "quantity";
}

export interface ProveedorAlterno {
  articuloId: string;
  proveedorId: string;
  costo: number;
  dias: number;
}

export interface Reorden {
  id: string;
  articuloId: string;
  proveedorId: string;
  cantidad: number;
  costo: number;
  fecha: string;
  llega: string;
}

export interface EstadoQbd {
  version: 1;
  generado: string;
  articulos: Articulo[];
  clientes: Cliente[];
  proveedores: Proveedor[];
  /** Órdenes de compra recibidas (de la muestra de QBO) para el costo de importación. */
  ordenesCompra: OrdenDeCompra[];
  fichas: FichaDeArticulo[];
  juegos: JuegoDeUnidades[];
  sitios: Sitio[];
  bins: Bin[];
  existencias: Existencia[];
  traspasos: Traspaso[];
  ordenes: OrdenDeVenta[];
  envios: Envio[];
  kits: Kit[];
  armados: Armado[];
  niveles: NivelDePrecio[];
  reglas: ReglaDePrecio[];
  importaciones: CostoDeImportacion[];
  alternos: ProveedorAlterno[];
  reordenes: Reorden[];
}
