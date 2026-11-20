/**
 * App Draft · QuickBooks Online: los datos de ejemplo. Inventados, pero de un negocio de loseta del Valle: contratistas
 * y dueños de casa, porcelanato, cerámica, thinset, boquilla y molduras, y los proveedores de siempre del ramo. Salen
 * de un generador con semilla fija, así que «Reset sample data» siempre devuelve lo mismo (relativo a la fecha de hoy).
 */
import { tasaDeImpuesto } from "@/lib/estimator/modelo";
import { telefonoEstandar } from "@/lib/recruiting/formato";
import { CTA, r2, saldoDeFactura, sumaDias, totalDe, totalGasto } from "./contabilidad";
import type {
  Articulo, AsientoManual, Cliente, Cuenta, EstadoQbo, Factura, FacturaProveedor, Linea, MovimientoBancario, NotaDeCredito,
  OrdenDeCompra, PagoAProveedor, PagoRecibido, Proveedor,
} from "./tipos";

export const TIENDAS = ["RDZ McAllen", "RDZ Mission", "RDZ Edinburg", "RDZ Weslaco", "RDZ Brownsville"] as const;

/** Generador pseudoaleatorio con semilla (mulberry32): mismos datos en cada reinicio. */
function azar(semilla: number) {
  let s = semilla >>> 0;
  const sig = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { sig, entero: (a: number, b: number) => a + Math.floor(sig() * (b - a + 1)), de: <T,>(xs: readonly T[]) => xs[Math.floor(sig() * xs.length)] };
}

export const CUENTAS: Cuenta[] = [
  { id: CTA.banco, numero: "1000", nombre_en: "Operating checking", nombre_es: "Cuenta de cheques", tipo: "bank" },
  { id: CTA.porCobrar, numero: "1200", nombre_en: "Money customers owe us (A/R)", nombre_es: "Lo que nos deben los clientes (por cobrar)", tipo: "ar" },
  { id: CTA.inventario, numero: "1300", nombre_en: "Inventory on hand", nombre_es: "Inventario en almacén", tipo: "asset" },
  { id: "a-1500", numero: "1500", nombre_en: "Trucks and equipment", nombre_es: "Camiones y equipo", tipo: "asset" },
  { id: CTA.porPagar, numero: "2000", nombre_en: "Money we owe vendors (A/P)", nombre_es: "Lo que debemos a proveedores (por pagar)", tipo: "ap" },
  { id: CTA.impuestos, numero: "2100", nombre_en: "Sales tax collected (owed to the state)", nombre_es: "Impuesto cobrado (se debe al estado)", tipo: "liability" },
  { id: "a-2200", numero: "2200", nombre_en: "Truck loan", nombre_es: "Préstamo del camión", tipo: "liability" },
  { id: CTA.capital, numero: "3000", nombre_en: "Owner's equity", nombre_es: "Capital del dueño", tipo: "equity" },
  { id: CTA.utilidades, numero: "3900", nombre_en: "Retained earnings", nombre_es: "Utilidades acumuladas", tipo: "equity" },
  { id: "a-4000", numero: "4000", nombre_en: "Tile sales", nombre_es: "Venta de loseta", tipo: "income" },
  { id: "a-4100", numero: "4100", nombre_en: "Setting materials sales", nombre_es: "Venta de materiales de instalación", tipo: "income" },
  { id: "a-4200", numero: "4200", nombre_en: "Delivery fees", nombre_es: "Cargos de entrega", tipo: "income" },
  { id: "a-4900", numero: "4900", nombre_en: "Other income", nombre_es: "Otros ingresos", tipo: "income" },
  { id: CTA.costoVendido, numero: "5000", nombre_en: "Cost of tile sold", nombre_es: "Costo de lo vendido", tipo: "cogs" },
  { id: "a-6000", numero: "6000", nombre_en: "Rent", nombre_es: "Renta", tipo: "expense" },
  { id: "a-6100", numero: "6100", nombre_en: "Utilities", nombre_es: "Luz, agua y teléfono", tipo: "expense" },
  { id: "a-6200", numero: "6200", nombre_en: "Fuel and truck costs", nombre_es: "Gasolina y camiones", tipo: "expense" },
  { id: "a-6300", numero: "6300", nombre_en: "Bank and card fees", nombre_es: "Comisiones del banco y tarjetas", tipo: "expense" },
  { id: "a-6400", numero: "6400", nombre_en: "Office and store supplies", nombre_es: "Papelería y tienda", tipo: "expense" },
  { id: "a-6500", numero: "6500", nombre_en: "Repairs and maintenance", nombre_es: "Reparaciones y mantenimiento", tipo: "expense" },
  { id: "a-6600", numero: "6600", nombre_en: "Advertising", nombre_es: "Publicidad", tipo: "expense" },
];

const PROVEEDORES: Proveedor[] = [
  { id: "v1", nombre: "Gulf Coast Porcelain Supply", telefono: telefonoEstandar("9565550101"), email: "orders@gulfcoastporcelain.example", plazo: 30, cuentaPorDefecto: CTA.inventario },
  { id: "v2", nombre: "Monterrey Ceramica Imports", telefono: telefonoEstandar("9565550102"), email: "ventas@mtyceramica.example", plazo: 45, cuentaPorDefecto: CTA.inventario },
  { id: "v3", nombre: "SetRight Mortars & Grout", telefono: telefonoEstandar("2105550103"), email: "ar@setright.example", plazo: 30, cuentaPorDefecto: CTA.inventario },
  { id: "v4", nombre: "Edge Pro Trim Co.", telefono: telefonoEstandar("7135550104"), email: "billing@edgeprotrim.example", plazo: 30, cuentaPorDefecto: CTA.inventario },
  { id: "v5", nombre: "Valley Freight Lines", telefono: telefonoEstandar("9565550105"), email: "dispatch@valleyfreight.example", plazo: 15, cuentaPorDefecto: "a-6200" },
  { id: "v6", nombre: "Palm Plaza Properties", telefono: telefonoEstandar("9565550106"), email: "leasing@palmplaza.example", plazo: 0, cuentaPorDefecto: "a-6000" },
  { id: "v7", nombre: "Rio Power & Light", telefono: telefonoEstandar("8005550107"), email: "service@riopower.example", plazo: 15, cuentaPorDefecto: "a-6100" },
  { id: "v8", nombre: "Border Office Supply", telefono: telefonoEstandar("9565550108"), email: "sales@borderoffice.example", plazo: 30, cuentaPorDefecto: "a-6400" },
];

function art(id: string, sku: string, nombre: string, unidad: string, precio: number, costo: number, cuentaIngreso: string, proveedorId: string | null, inventario = true): Articulo {
  return { id, sku, nombre, unidad, precio, costo, inventario, cuentaIngreso, proveedorId };
}

const ARTICULOS: Articulo[] = [
  art("i01", "POR-2448-CAL", "Porcelain 24x48 Calacatta matte", "sq ft", 4.29, 2.1, "a-4000", "v1"),
  art("i02", "POR-2424-GRY", "Porcelain 24x24 Urban gray", "sq ft", 2.99, 1.42, "a-4000", "v1"),
  art("i03", "POR-1224-OAK", "Wood-look porcelain 8x48 Oak", "sq ft", 3.49, 1.65, "a-4000", "v1"),
  art("i04", "POR-1224-WAL", "Wood-look porcelain 8x48 Walnut", "sq ft", 3.59, 1.7, "a-4000", "v1"),
  art("i05", "POR-3232-MAR", "Porcelain 32x32 Marble polished", "sq ft", 4.89, 2.4, "a-4000", "v2"),
  art("i06", "POR-1818-TRV", "Porcelain 18x18 Travertine", "sq ft", 2.49, 1.15, "a-4000", "v2"),
  art("i07", "CER-1212-BEI", "Ceramic 12x12 Beige", "sq ft", 1.19, 0.52, "a-4000", "v2"),
  art("i08", "CER-1616-SAL", "Ceramic 16x16 Saltillo look", "sq ft", 1.49, 0.66, "a-4000", "v2"),
  art("i09", "CER-0412-WHT", "Ceramic subway 4x12 white gloss", "sq ft", 2.29, 0.98, "a-4000", "v2"),
  art("i10", "CER-0303-HEX", "Ceramic hex mosaic 3in", "sheet", 9.99, 4.6, "a-4000", "v2"),
  art("i11", "MOS-GLS-BLU", "Glass mosaic blue blend", "sheet", 14.99, 6.9, "a-4000", "v1"),
  art("i12", "POR-0624-PLK", "Porcelain plank 6x24 Driftwood", "sq ft", 2.79, 1.3, "a-4000", "v1"),
  art("i13", "OUT-2424-PAV", "Outdoor paver 24x24 20mm", "sq ft", 5.49, 2.9, "a-4000", "v1"),
  art("i14", "POR-1224-CEM", "Porcelain 12x24 Cement look", "sq ft", 2.69, 1.24, "a-4000", "v2"),
  art("i15", "THN-MOD-50", "Modified thinset 50 lb gray", "bag", 24.99, 12.5, "a-4100", "v3"),
  art("i16", "THN-LFT-50", "Large-format thinset 50 lb white", "bag", 32.99, 16.8, "a-4100", "v3"),
  art("i17", "THN-STD-50", "Standard thinset 50 lb", "bag", 14.99, 7.1, "a-4100", "v3"),
  art("i18", "GRT-SAN-25", "Sanded grout 25 lb", "bag", 21.99, 9.8, "a-4100", "v3"),
  art("i19", "GRT-UNS-10", "Unsanded grout 10 lb", "bag", 16.99, 7.4, "a-4100", "v3"),
  art("i20", "GRT-EPX-1G", "Epoxy grout 1 gal kit", "kit", 89.99, 44, "a-4100", "v3"),
  art("i21", "SLR-50", "Self-leveling underlayment 50 lb", "bag", 39.99, 21, "a-4100", "v3"),
  art("i22", "MEM-UNC-323", "Uncoupling membrane 323 sq ft roll", "roll", 349, 205, "a-4100", "v3"),
  art("i23", "WPF-1G", "Waterproofing membrane 1 gal", "bucket", 64.99, 31, "a-4100", "v3"),
  art("i24", "TRM-ALU-8", "Aluminum edge trim 8 ft", "piece", 12.99, 5.2, "a-4100", "v4"),
  art("i25", "TRM-SS-8", "Stainless steel edge trim 8 ft", "piece", 24.99, 11.4, "a-4100", "v4"),
  art("i26", "TRM-BULL-12", "Bullnose 3x12 matching", "piece", 4.49, 1.9, "a-4100", "v4"),
  art("i27", "TRM-STR-36", "Stair nosing 36 in", "piece", 18.99, 8.2, "a-4100", "v4"),
  art("i28", "SPC-3-16", "Tile spacers 3/16 (500)", "bag", 7.99, 2.6, "a-4100", "v4"),
  art("i29", "LVL-SYS", "Leveling clips and wedges kit", "kit", 54.99, 24, "a-4100", "v4"),
  art("i30", "DEL-FEE", "Delivery fee (Valley)", "trip", 75, 0, "a-4200", null, false),
];

const CLIENTES_BASE: [string, string | null, Cliente["tipo"], number, string][] = [
  ["Javier Cantu", "Cantu Custom Floors", "contractor", 30, "RDZ McAllen"],
  ["Marisol Garza", "Garza Remodeling LLC", "contractor", 30, "RDZ Edinburg"],
  ["Roberto Salinas", "Salinas Tile & Stone", "contractor", 15, "RDZ Mission"],
  ["Ana Villarreal", null, "homeowner", 0, "RDZ McAllen"],
  ["Luis Treviño", "Treviño Builders", "contractor", 30, "RDZ Weslaco"],
  ["Patricia Olivarez", null, "homeowner", 0, "RDZ Brownsville"],
  ["Daniel Ramirez", "RGV Home Pros", "contractor", 30, "RDZ Edinburg"],
  ["Sofia Hinojosa", "Hinojosa Interiors", "designer", 15, "RDZ McAllen"],
  ["Miguel Peña", "Peña Construction", "contractor", 30, "RDZ Brownsville"],
  ["Karen Whitfield", null, "homeowner", 0, "RDZ Mission"],
  ["Eduardo Longoria", "Longoria & Sons Flooring", "contractor", 30, "RDZ Weslaco"],
  ["Gabriela Moreno", null, "homeowner", 0, "RDZ Edinburg"],
  ["Tomas Reyna", "Reyna Property Services", "contractor", 15, "RDZ Mission"],
  ["Claudia Benavides", "Casa Bella Design", "designer", 15, "RDZ McAllen"],
  ["Steve Morales", "Southmost Renovations", "contractor", 30, "RDZ Brownsville"],
];

function clientes(): Cliente[] {
  return CLIENTES_BASE.map(([nombre, empresa, tipo, plazo, tienda], i) => ({
    id: `c${String(i + 1).padStart(2, "0")}`, nombre, empresa, tipo, plazo, tienda,
    telefono: telefonoEstandar(`956555${String(1200 + i * 37).padStart(4, "0")}`),
    email: `${nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, ".")}@example.com`,
  }));
}

/** Arma todo el estado de ejemplo, con 90 días de historia que terminan en `hoy`. */
export function generarMuestra(hoy: string): EstadoQbo {
  const R = azar(20261119);
  const inicio = sumaDias(hoy, -90);
  const cli = clientes();
  const tiles = ARTICULOS.filter((a) => a.cuentaIngreso === "a-4000");
  const materiales = ARTICULOS.filter((a) => a.cuentaIngreso === "a-4100");

  // ---- Saldos iniciales: un asiento el día antes del primer movimiento.
  const asientos: AsientoManual[] = [{
    id: "je-0", numero: "JE-1000", fecha: sumaDias(inicio, -1), memo: "Opening balances",
    lineas: [
      { cuentaId: CTA.banco, debe: 85000, haber: 0 },
      { cuentaId: CTA.inventario, debe: 142000, haber: 0 },
      { cuentaId: "a-1500", debe: 68000, haber: 0 },
      { cuentaId: "a-2200", debe: 0, haber: 41000 },
      { cuentaId: CTA.capital, debe: 0, haber: 254000 },
    ],
  }];

  // ---- 40 facturas de venta a lo largo de 90 días.
  const facturas: Factura[] = [];
  for (let i = 0; i < 40; i++) {
    const c = cli[R.entero(0, cli.length - 1)];
    const fecha = sumaDias(inicio, Math.min(89, Math.floor((i * 90) / 40) + R.entero(0, 2)));
    const lineas: Linea[] = [];
    const tile = R.de(tiles);
    const pies = c.tipo === "homeowner" ? R.entero(12, 45) * 10 : R.entero(30, 160) * 10;
    lineas.push({ articuloId: tile.id, descripcion: tile.nombre, cantidad: tile.unidad === "sheet" ? Math.round(pies / 10) : pies, precio: tile.precio });
    const nMat = R.entero(1, 3);
    for (let k = 0; k < nMat; k++) {
      const m = R.de(materiales);
      if (lineas.some((l) => l.articuloId === m.id)) continue;
      lineas.push({ articuloId: m.id, descripcion: m.nombre, cantidad: m.unidad === "roll" ? 1 : R.entero(2, 18), precio: m.precio });
    }
    if (R.sig() < 0.45) lineas.push({ articuloId: "i30", descripcion: "Delivery fee (Valley)", cantidad: 1, precio: 75 });
    const plazo = c.plazo || 0;
    facturas.push({
      id: `inv-${i + 1}`, numero: String(1001 + i), clienteId: c.id, tienda: c.tienda, fecha, vence: sumaDias(fecha, plazo),
      lineas, tasa: tasaDeImpuesto(c.tienda), borrador: i >= 38, enviada: i < 38, nota: "",
    });
  }

  // ---- Pagos: las de contado se pagan el mismo día; las de crédito, la mayoría pagadas, algunas a medias, otras no.
  const pagos: PagoRecibido[] = [];
  let nPago = 1;
  for (const f of facturas) {
    if (f.borrador) continue;
    const total = totalDe(f.lineas, f.tasa);
    const c = cli.find((x) => x.id === f.clienteId)!;
    const edad = (Date.parse(hoy) - Date.parse(f.fecha)) / 86400000;
    let monto = 0, fecha = f.fecha;
    const tiro = R.sig();
    if (c.plazo === 0) { monto = total; }
    else if (edad > 45 && tiro < 0.7) { monto = total; fecha = sumaDias(f.vence, R.entero(-5, 12)); }
    else if (edad > 20 && tiro < 0.45) { monto = total; fecha = sumaDias(f.fecha, R.entero(8, 18)); }
    else if (tiro < 0.6) { monto = r2(Math.round(total * 0.5)); fecha = sumaDias(f.fecha, R.entero(3, 10)); }
    if (monto <= 0 || fecha > hoy) continue;
    pagos.push({
      id: `pay-${nPago}`, numero: `P-${2000 + nPago}`, clienteId: f.clienteId, fecha, monto,
      metodo: c.plazo === 0 ? R.de(["card", "cash", "card"] as const) : R.de(["check", "transfer"] as const),
      referencia: c.plazo === 0 ? "" : `#${R.entero(1100, 9800)}`, cuentaBanco: CTA.banco, aplicado: [{ facturaId: f.id, monto }],
    });
    nPago++;
  }

  // ---- Dos notas de crédito: una aplicada (loseta devuelta), otra todavía sin aplicar.
  const notas: NotaDeCredito[] = [];
  const conSaldo = facturas.filter((f) => !f.borrador && saldoDeFactura(f, pagos, []).saldo > 50);
  if (conSaldo[0]) {
    const f = conSaldo[0];
    const l = f.lineas[0];
    const ln: Linea = { articuloId: l.articuloId, descripcion: `Returned: ${l.descripcion}`, cantidad: Math.max(1, Math.round(l.cantidad * 0.1)), precio: l.precio };
    const total = totalDe([ln], f.tasa);
    const saldo = saldoDeFactura(f, pagos, []).saldo;
    notas.push({ id: "cm-1", numero: "CM-501", clienteId: f.clienteId, fecha: sumaDias(f.fecha, 6), lineas: [ln], tasa: f.tasa, motivo: "Returned extra boxes", aplicado: [{ facturaId: f.id, monto: Math.min(total, saldo) }] });
  }
  {
    const c = cli[2];
    notas.push({ id: "cm-2", numero: "CM-502", clienteId: c.id, fecha: sumaDias(hoy, -9), lineas: [{ articuloId: "i26", descripcion: "Chipped bullnose (damaged on delivery)", cantidad: 12, precio: 4.49 }], tasa: tasaDeImpuesto(c.tienda), motivo: "Damaged on delivery", aplicado: [] });
  }

  // ---- Órdenes de compra y facturas de proveedor.
  const ordenes: OrdenDeCompra[] = [];
  const facturasProv: FacturaProveedor[] = [];
  const pagosProv: PagoAProveedor[] = [];
  const provInv = PROVEEDORES.slice(0, 4);
  let nBill = 1, nPo = 1, nBp = 1;
  for (let k = 0; k < 8; k++) {
    const v = provInv[k % 4];
    const fecha = sumaDias(inicio, 4 + k * 11);
    const arts = ARTICULOS.filter((a) => a.proveedorId === v.id);
    const lineas = [0, 1, 2].map(() => R.de(arts)).filter((a, i, xs) => xs.findIndex((b) => b.id === a.id) === i).map((a) => {
      const cantidad = a.unidad === "sq ft" ? R.entero(20, 60) * 50 : R.entero(10, 60);
      return { articuloId: a.id, cantidad, costo: a.costo, recibido: 0, facturado: 0 };
    });
    const o: OrdenDeCompra = { id: `po-${nPo}`, numero: `PO-${3100 + nPo}`, proveedorId: v.id, fecha, esperada: sumaDias(fecha, 10), lineas, enviada: k < 7, cerrada: false };
    nPo++;
    // Las viejas ya llegaron y se facturaron; la sexta llegó a medias; la séptima sigue abierta; la octava es borrador.
    if (k < 5) {
      o.lineas = o.lineas.map((l) => ({ ...l, recibido: l.cantidad, facturado: l.cantidad }));
      const b: FacturaProveedor = {
        id: `bill-${nBill}`, numero: `${v.nombre.split(" ")[0].toUpperCase()}-${R.entero(10000, 99999)}`, proveedorId: v.id,
        fecha: sumaDias(fecha, 9), vence: sumaDias(fecha, 9 + v.plazo), ordenId: o.id, nota: "",
        lineas: o.lineas.map((l) => ({ cuentaId: CTA.inventario, descripcion: ARTICULOS.find((a) => a.id === l.articuloId)!.nombre, monto: r2(l.cantidad * l.costo), articuloId: l.articuloId, cantidad: l.cantidad })),
      };
      facturasProv.push(b);
      nBill++;
    } else if (k === 5) {
      o.lineas = o.lineas.map((l, i) => ({ ...l, recibido: i === 0 ? l.cantidad : Math.floor(l.cantidad / 2) }));
    }
    ordenes.push(o);
  }
  // Gastos fijos por factura: renta y luz cada mes, flete de vez en cuando, papelería.
  for (let mes = 0; mes < 3; mes++) {
    const f1 = sumaDias(inicio, 2 + mes * 30);
    facturasProv.push({ id: `bill-${nBill++}`, numero: `RENT-${mes + 1}`, proveedorId: "v6", fecha: f1, vence: f1, ordenId: null, nota: "", lineas: [{ cuentaId: "a-6000", descripcion: "Store and warehouse rent", monto: 6500 }] });
    const f2 = sumaDias(inicio, 12 + mes * 30);
    facturasProv.push({ id: `bill-${nBill++}`, numero: `RPL-${R.entero(400000, 499999)}`, proveedorId: "v7", fecha: f2, vence: sumaDias(f2, 15), ordenId: null, nota: "", lineas: [{ cuentaId: "a-6100", descripcion: "Electric service", monto: r2(380 + R.sig() * 220) }] });
    const f3 = sumaDias(inicio, 18 + mes * 30);
    facturasProv.push({ id: `bill-${nBill++}`, numero: `VFL-${R.entero(7000, 7999)}`, proveedorId: "v5", fecha: f3, vence: sumaDias(f3, 15), ordenId: null, nota: "", lineas: [{ cuentaId: "a-6200", descripcion: "Freight from Houston port", monto: r2(650 + R.sig() * 500) }] });
  }
  facturasProv.push({ id: `bill-${nBill++}`, numero: "BOS-22817", proveedorId: "v8", fecha: sumaDias(hoy, -20), vence: sumaDias(hoy, 10), ordenId: null, nota: "", lineas: [{ cuentaId: "a-6400", descripcion: "Receipt paper, labels, toner", monto: 286.4 }] });

  // Pagos a proveedores: lo vencido hace más de una semana se pagó; lo demás queda abierto.
  for (const b of facturasProv) {
    const total = totalGasto(b.lineas);
    if (b.vence < sumaDias(hoy, -7) || (b.proveedorId === "v6" && b.fecha <= hoy)) {
      const fecha = b.proveedorId === "v6" ? b.fecha : sumaDias(b.vence, -R.entero(0, 3));
      pagosProv.push({ id: `bp-${nBp}`, numero: `CHK-${5400 + nBp}`, proveedorId: b.proveedorId, fecha: fecha > hoy ? hoy : fecha, cuentaBanco: CTA.banco, metodo: b.proveedorId === "v6" ? "ach" : "check", aplicado: [{ facturaId: b.id, monto: total }] });
      nBp++;
    }
  }

  // ---- El «feed» del banco: los depósitos y cheques registrados llegan al banco 1–3 días después, más cargos que
  // todavía nadie ha registrado (comisiones, gasolina con la tarjeta de débito, publicidad).
  const movimientos: MovimientoBancario[] = [];
  let nMov = 1;
  const corte = sumaDias(hoy, -14);
  for (const p of pagos) {
    const f = sumaDias(p.fecha, 1);
    if (f > hoy) continue;
    const viejo = f < corte;
    movimientos.push({ id: `bt-${nMov++}`, bancoId: "bank-1", fecha: f, descripcion: p.metodo === "card" ? "CARD SETTLEMENT DEPOSIT" : p.metodo === "cash" ? "BRANCH CASH DEPOSIT" : `MOBILE DEPOSIT ${p.referencia}`.trim(), monto: p.monto, estado: viejo ? "matched" : "new", categoriaId: null, enlace: viejo ? { tipo: "payment", id: p.id } : null });
  }
  for (const p of pagosProv) {
    const f = sumaDias(p.fecha, 2);
    if (f > hoy) continue;
    const viejo = f < corte;
    const v = PROVEEDORES.find((x) => x.id === p.proveedorId)!;
    const monto = -p.aplicado.reduce((a, x) => a + x.monto, 0);
    movimientos.push({ id: `bt-${nMov++}`, bancoId: "bank-1", fecha: f, descripcion: p.metodo === "ach" ? `ACH DEBIT ${v.nombre.toUpperCase()}` : `CHECK ${p.numero.replace("CHK-", "")}`, monto: r2(monto), estado: viejo ? "matched" : "new", categoriaId: null, enlace: viejo ? { tipo: "billPayment", id: p.id } : null });
  }
  const extras: [string, number, string][] = [];
  for (let mes = 0; mes < 3; mes++) extras.push([sumaDias(inicio, 28 + mes * 30), -35, "MONTHLY SERVICE FEE"]);
  for (let k = 0; k < 9; k++) extras.push([sumaDias(inicio, 5 + k * 10), -r2(70 + R.sig() * 140), R.de(["VALERO #4471 MCALLEN", "SHELL OIL 5520 EDINBURG", "STRIPES #219 WESLACO"])]);
  extras.push([sumaDias(inicio, 40), -450, "FACEBOOK ADS"]);
  extras.push([sumaDias(hoy, -6), -450, "FACEBOOK ADS"]);
  extras.push([sumaDias(hoy, -3), -128.75, "HOME DEPOT #6589"]);
  extras.push([sumaDias(hoy, -2), 12.4, "INTEREST PAYMENT"]);
  for (const [fecha, monto, descripcion] of extras) {
    if (fecha > hoy) continue;
    const viejo = fecha < corte;
    const cat = descripcion.includes("FEE") ? "a-6300" : descripcion.includes("ADS") ? "a-6600" : descripcion.includes("INTEREST") ? "a-4900" : descripcion.includes("HOME DEPOT") ? "a-6500" : "a-6200";
    movimientos.push({ id: `bt-${nMov++}`, bancoId: "bank-1", fecha, descripcion, monto, estado: viejo ? "categorized" : "new", categoriaId: viejo ? cat : null, enlace: null });
  }
  movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));

  return {
    version: 1,
    generado: hoy,
    cuentas: CUENTAS,
    clientes: cli,
    proveedores: PROVEEDORES,
    articulos: ARTICULOS,
    facturas,
    pagos,
    notas,
    facturasProv,
    pagosProv,
    creditosProv: [],
    ordenes,
    bancos: [{ id: "bank-1", nombre: "Operating checking", ultimos4: "4821", cuentaId: CTA.banco, saldoInicialBanco: 85000 }],
    movimientos,
    reglas: [
      { id: "r-1", contiene: "VALERO", cuentaId: "a-6200" },
      { id: "r-2", contiene: "SHELL", cuentaId: "a-6200" },
      { id: "r-3", contiene: "SERVICE FEE", cuentaId: "a-6300" },
    ],
    asientos,
    conciliados: ["journal:je-0:0"],
    conciliaciones: [],
  };
}
