/**
 * App Draft · Comp Floor: datos de ejemplo (inventados). Fechas relativas a `hoy` para que siempre se vean recientes.
 */
import { convertirAPedido, sumaDias } from "./logica";
import type { EstadoCf, Existencia, Pedido } from "./tipos";

export function generarMuestra(hoy: string): EstadoCf {
  const existencias: Existencia[] = [
    // Travertino 12x24: dos lotes que NO combinan entre sí.
    { id: "x-1", articuloId: "a-trav", tienda: "mca", lote: "L2405", tono: "B", bin: "A-01", cajas: 40, remanentePct: null },
    { id: "x-2", articuloId: "a-trav", tienda: "mca", lote: "L2411", tono: "C", bin: "A-02", cajas: 12, remanentePct: null },
    { id: "x-3", articuloId: "a-trav", tienda: "edi", lote: "L2405", tono: "B", bin: "A-01", cajas: 25, remanentePct: null },
    { id: "x-4", articuloId: "a-trav", tienda: "bro", lote: "L2411", tono: "C", bin: "B-01", cajas: 60, remanentePct: null },
    // Calacatta 24x48
    { id: "x-5", articuloId: "a-cala", tienda: "mca", lote: "L1180", tono: "A", bin: "B-02", cajas: 18, remanentePct: null },
    { id: "x-6", articuloId: "a-cala", tienda: "mis", lote: "L1192", tono: "A", bin: "A-01", cajas: 30, remanentePct: null },
    // Tablón imitación madera
    { id: "x-7", articuloId: "a-wood", tienda: "mca", lote: "W77", tono: "2", bin: "C-01", cajas: 70, remanentePct: null },
    { id: "x-8", articuloId: "a-wood", tienda: "wes", lote: "W81", tono: "3", bin: "A-01", cajas: 45, remanentePct: null },
    { id: "x-9", articuloId: "a-wood", tienda: "wes", lote: "W70", tono: "1", bin: "C-03", cajas: 3, remanentePct: 40 },
    // Subway: en todas las tiendas
    { id: "x-10", articuloId: "a-sub", tienda: "mca", lote: "S10", tono: "W", bin: "B-01", cajas: 120, remanentePct: null },
    { id: "x-11", articuloId: "a-sub", tienda: "mis", lote: "S10", tono: "W", bin: "B-01", cajas: 60, remanentePct: null },
    { id: "x-12", articuloId: "a-sub", tienda: "edi", lote: "S12", tono: "W", bin: "B-02", cajas: 75, remanentePct: null },
    { id: "x-13", articuloId: "a-sub", tienda: "wes", lote: "S12", tono: "W", bin: "B-01", cajas: 40, remanentePct: null },
    { id: "x-14", articuloId: "a-sub", tienda: "bro", lote: "S10", tono: "W", bin: "A-02", cajas: 90, remanentePct: null },
    // Mosaico hexagonal
    { id: "x-15", articuloId: "a-hex", tienda: "mca", lote: "M5", tono: "Carrara", bin: "D-01", cajas: 9, remanentePct: null },
    { id: "x-16", articuloId: "a-hex", tienda: "edi", lote: "M3", tono: "Carrara", bin: "C-01", cajas: 2, remanentePct: 25 },
    // Boquilla (no tiene lote de color: «—»)
    { id: "x-17", articuloId: "a-grout", tienda: "mca", lote: "—", tono: "—", bin: "E-01", cajas: 150, remanentePct: null },
    { id: "x-18", articuloId: "a-grout", tienda: "bro", lote: "—", tono: "—", bin: "E-01", cajas: 70, remanentePct: null },
  ];

  const base: EstadoCf = {
    version: 1,
    articulos: [
      { id: "a-trav", sku: "TRV-1224", nombre: "Travertine-look porcelain 12x24", sqftPorCaja: 15.5, piezasPorCaja: 8, unidadVenta: "sqft", precioCaja: 38.75, costoCaja: 21.7, proveedorId: "v-1" },
      { id: "a-cala", sku: "CAL-2448", nombre: "Calacatta porcelain 24x48", sqftPorCaja: 15.5, piezasPorCaja: 2, unidadVenta: "sqft", precioCaja: 69.75, costoCaja: 41.85, proveedorId: "v-1" },
      { id: "a-wood", sku: "WDP-0848", nombre: "Oak wood-look plank 8x48", sqftPorCaja: 13.3, piezasPorCaja: 5, unidadVenta: "sqft", precioCaja: 33.25, costoCaja: 18.62, proveedorId: "v-2" },
      { id: "a-sub", sku: "SUB-0306", nombre: "White subway ceramic 3x6", sqftPorCaja: 12.5, piezasPorCaja: 100, unidadVenta: "box", precioCaja: 18.75, costoCaja: 9.4, proveedorId: "v-2" },
      { id: "a-hex", sku: "HEX-0202", nombre: "Hexagon marble mosaic (sheets)", sqftPorCaja: 10, piezasPorCaja: 10, unidadVenta: "pc", precioCaja: 89, costoCaja: 52, proveedorId: "v-3" },
      { id: "a-grout", sku: "GRT-25G", nombre: "Sanded grout 25 lb, gray", sqftPorCaja: 0, piezasPorCaja: 1, unidadVenta: "box", precioCaja: 24, costoCaja: 12.5, proveedorId: "v-3" },
      { id: "a-slate", sku: "SLT-1616", nombre: "Black slate 16x16 (special order)", sqftPorCaja: 14.2, piezasPorCaja: 8, unidadVenta: "sqft", precioCaja: 42.6, costoCaja: 25.5, proveedorId: "v-3" },
    ],
    existencias,
    clientes: [
      { id: "c-1", nombre: "María Garza (walk-in)", tipo: "retail", telefono: "(956) 555-0141", limite: null, saldo: 0 },
      { id: "c-2", nombre: "Rio Grande Tile Setters", tipo: "contractor", telefono: "(956) 555-0187", limite: 5000, saldo: 3200 },
      { id: "c-3", nombre: "Héctor Ruiz Installations", tipo: "contractor", telefono: "(956) 555-0112", limite: 2500, saldo: 2300 },
      { id: "c-4", nombre: "Valley Floors & More", tipo: "dealer", telefono: "(956) 555-0165", limite: 20000, saldo: 8450 },
      { id: "c-5", nombre: "Lupita Treviño", tipo: "retail", telefono: "(956) 555-0130", limite: null, saldo: 0 },
    ],
    proveedores: [
      { id: "v-1", nombre: "Gulf Coast Porcelain Supply" },
      { id: "v-2", nombre: "Lone Star Ceramics" },
      { id: "v-3", nombre: "Border Stone & Setting Materials" },
    ],
    niveles: [
      { tipo: "retail", descuentoPct: 0, fijos: {} },
      { tipo: "contractor", descuentoPct: 12, fijos: {} },
      { tipo: "dealer", descuentoPct: 20, fijos: { "a-sub": 14 } },
    ],
    bins: {
      mca: ["A-01", "A-02", "B-01", "B-02", "C-01", "D-01", "E-01"],
      mis: ["A-01", "B-01", "C-01"],
      edi: ["A-01", "B-02", "C-01"],
      wes: ["A-01", "B-01", "C-03"],
      bro: ["A-02", "B-01", "E-01"],
    },
    pedidos: [],
    envios: [],
    ventas: [],
    especiales: [],
    alertas: [],
    traslados: [],
  };

  // Pedido viejo de un instalador: 24 cajas de un lote que solo tiene 18 → 6 por surtir; y una línea especial.
  const p1: Pedido = {
    id: "p-1", numero: "SO-5001", clienteId: "c-2", tienda: "mca", fecha: sumaDias(hoy, -6), prioridad: 2, etapa: "quote",
    lineas: [
      { id: "l-1", articuloId: "a-cala", cajas: 24, precioCaja: 61.38, existenciaId: "x-5", reservadas: 0, enviadas: 0 },
      { id: "l-2", articuloId: "a-slate", cajas: 20, precioCaja: 37.49, existenciaId: null, reservadas: 0, enviadas: 0, ocId: "oc-1" },
    ],
  };
  // Pedido urgente de un distribuidor, sin lote todavía (McAllen no tiene libre) → todo por surtir.
  const p2: Pedido = {
    id: "p-2", numero: "SO-5002", clienteId: "c-4", tienda: "mca", fecha: sumaDias(hoy, -2), prioridad: 1, etapa: "quote",
    lineas: [{ id: "l-3", articuloId: "a-cala", cajas: 10, precioCaja: 55.8, existenciaId: null, reservadas: 0, enviadas: 0 }],
  };
  // Cotización abierta: 50 cajas de un lote que tiene 40.
  const p3: Pedido = {
    id: "p-3", numero: "SO-5003", clienteId: "c-5", tienda: "mca", fecha: sumaDias(hoy, -1), prioridad: 2, etapa: "quote",
    lineas: [
      { id: "l-4", articuloId: "a-trav", cajas: 50, precioCaja: 38.75, existenciaId: "x-1", reservadas: 0, enviadas: 0 },
      { id: "l-5", articuloId: "a-grout", cajas: 4, precioCaja: 24, existenciaId: "x-17", reservadas: 0, enviadas: 0 },
    ],
  };
  let e = base;
  const o1 = convertirAPedido(e, p1);
  e = { ...e, pedidos: [o1] };
  const o2 = convertirAPedido(e, { ...p2, lineas: p2.lineas.map((l) => ({ ...l, existenciaId: null })) });
  // McAllen no tiene Calacatta libre: queda sin lote y todo por surtir.
  const o2b = { ...o2, lineas: o2.lineas.map((l) => (l.reservadas === 0 ? { ...l, existenciaId: null } : l)) };
  e = { ...e, pedidos: [o1, o2b, p3] };

  return {
    ...e,
    especiales: [{ id: "oc-1", numero: "PO-7001", proveedorId: "v-3", articuloId: "a-slate", cajas: 20, pedidoId: "p-1", lineaId: "l-2", fecha: sumaDias(hoy, -6), recibida: false }],
    ventas: [{
      id: "v-s1", numero: "CS-9001", clienteId: null, tienda: "mca", fecha: sumaDias(hoy, -1), pago: "cash",
      lineas: [{ articuloId: "a-grout", existenciaId: "x-17", cajas: 2, precioCaja: 24 }], total: 48,
    }],
    traslados: [{
      id: "t-1", numero: "TR-301", existenciaOrigenId: "x-7", articuloId: "a-wood", lote: "W77", tono: "2", desde: "mca", hacia: "bro",
      binDestino: "B-01", cajas: 10, fecha: sumaDias(hoy, -1), recibido: false,
    }],
  };
}
