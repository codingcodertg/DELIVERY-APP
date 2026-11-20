/**
 * App Draft · QuickBooks Desktop: los datos de ejemplo. Clientes, proveedores, artículos y órdenes de compra vienen de la
 * muestra de QuickBooks Online (se importan con `generarMuestra`, no se copian); aquí solo se agrega lo del escritorio.
 * Determinista: «Reset sample data» siempre devuelve lo mismo, relativo a la fecha de hoy.
 */
import { generarMuestra } from "../qbo/muestra";
import { inicioDeMes } from "../qbo/contabilidad";
import { precioBaseDe, precioDeLinea, r2, sumaDias } from "./inventario";
import type {
  Bin, Categoria, EstadoQbd, Existencia, FichaDeArticulo, JuegoDeUnidades, Kit, LineaDeVenta, NivelDePrecio, OrdenDeVenta,
  ProveedorAlterno, ReglaDePrecio, Sitio,
} from "./tipos";

export const SITIOS: Sitio[] = [
  { id: "s-cen", nombre: "Central warehouse (Pharr)" },
  { id: "s-mca", nombre: "RDZ McAllen" },
  { id: "s-mis", nombre: "RDZ Mission" },
  { id: "s-edi", nombre: "RDZ Edinburg" },
  { id: "s-wes", nombre: "RDZ Weslaco" },
  { id: "s-bro", nombre: "RDZ Brownsville" },
];

const JUEGOS: JuegoDeUnidades[] = [
  { id: "u-2448", nombre: "Tile 24x48 (2 pcs = 15.5 sq ft per box)", base: "box", unidades: [{ u: "box", factor: 1 }, { u: "sq ft", factor: 1 / 15.5 }, { u: "piece", factor: 0.5 }, { u: "pallet", factor: 32 }], compra: "pallet", venta: "sq ft", envio: "box" },
  { id: "u-2424", nombre: "Tile 24x24 / 32x32 (15.5 sq ft per box)", base: "box", unidades: [{ u: "box", factor: 1 }, { u: "sq ft", factor: 1 / 15.5 }, { u: "piece", factor: 0.25 }, { u: "pallet", factor: 40 }], compra: "pallet", venta: "sq ft", envio: "box" },
  { id: "u-plank", nombre: "Plank 8x48 (6 pcs = 15.5 sq ft per box)", base: "box", unidades: [{ u: "box", factor: 1 }, { u: "sq ft", factor: 1 / 15.5 }, { u: "piece", factor: 1 / 6 }, { u: "pallet", factor: 45 }], compra: "pallet", venta: "sq ft", envio: "box" },
  { id: "u-1212", nombre: "Ceramic 12x12 (11 sq ft per box)", base: "box", unidades: [{ u: "box", factor: 1 }, { u: "sq ft", factor: 1 / 11 }, { u: "piece", factor: 1 / 11 }, { u: "pallet", factor: 60 }], compra: "pallet", venta: "sq ft", envio: "box" },
  { id: "u-subway", nombre: "Subway 4x12 (10 sq ft = 30 pcs per box)", base: "box", unidades: [{ u: "box", factor: 1 }, { u: "sq ft", factor: 0.1 }, { u: "piece", factor: 1 / 30 }, { u: "pallet", factor: 60 }], compra: "pallet", venta: "sq ft", envio: "box" },
  { id: "u-bolsa", nombre: "Bags (56 per pallet)", base: "bag", unidades: [{ u: "bag", factor: 1 }, { u: "pallet", factor: 56 }], compra: "pallet", venta: "bag", envio: "bag" },
  { id: "u-cubeta", nombre: "Buckets (36 per pallet)", base: "bucket", unidades: [{ u: "bucket", factor: 1 }, { u: "pallet", factor: 36 }], compra: "pallet", venta: "bucket", envio: "bucket" },
  { id: "u-pieza", nombre: "Trim pieces (bundle of 10)", base: "piece", unidades: [{ u: "piece", factor: 1 }, { u: "bundle", factor: 10 }], compra: "bundle", venta: "piece", envio: "piece" },
];

/** [artículo de QBO, categoría, juego, con lote, punto de reorden]. */
const FICHAS: [string, Categoria, string, boolean, number][] = [
  ["i01", "tile", "u-2448", false, 120],
  ["i02", "tile", "u-2424", false, 150],
  ["i03", "tile", "u-plank", false, 100],
  ["i05", "tile", "u-2424", false, 200],
  ["i07", "tile", "u-1212", false, 80],
  ["i09", "tile", "u-subway", false, 60],
  ["i15", "setting", "u-bolsa", true, 120],
  ["i16", "setting", "u-bolsa", true, 60],
  ["i18", "setting", "u-bolsa", true, 80],
  ["i19", "setting", "u-bolsa", true, 40],
  ["i23", "setting", "u-cubeta", true, 30],
  ["i24", "trim", "u-pieza", false, 80],
  ["i26", "trim", "u-pieza", false, 150],
];

function bins(): Bin[] {
  const out: Bin[] = [];
  const pon = (sitioId: string, codigos: string[]) => codigos.forEach((c) => out.push({ id: `${sitioId}-${c}`, sitioId, codigo: c }));
  pon("s-cen", ["A-01-1", "A-01-2", "A-02-1", "B-01-1", "B-02-1", "C-01-1"]);
  pon("s-mca", ["R-01", "R-02", "R-03", "YARD-1"]);
  for (const s of ["s-mis", "s-edi", "s-wes", "s-bro"]) pon(s, ["R-01", "R-02"]);
  return out;
}

/** Cajas/bolsas/piezas por sitio: [central, McAllen, Mission, Edinburg, Weslaco, Brownsville]. */
const CANTIDADES: Record<string, number[]> = {
  i01: [64, 10, 6, 12, 0, 8],
  i02: [120, 30, 14, 20, 18, 10],
  i03: [90, 22, 8, 16, 10, 6],
  i05: [80, 14, 0, 10, 6, 4],
  i07: [60, 25, 18, 20, 12, 15],
  i09: [40, 18, 6, 10, 4, 6],
  i15: [84, 30, 12, 20, 16, 14],
  i16: [40, 10, 4, 8, 6, 4],
  i18: [50, 16, 8, 10, 6, 6],
  i19: [24, 8, 4, 6, 2, 4],
  i23: [20, 6, 2, 4, 2, 2],
  i24: [120, 40, 12, 20, 10, 16],
  i26: [200, 60, 30, 40, 24, 30],
};

/** Desfases de caducidad para los lotes de polvos (días desde hoy): uno ya caducado, varios dentro de 30/60/90. */
const CADUCIDADES = [-6, 18, 44, 75, 140, 210];

export function generarMuestraQbd(hoy: string): EstadoQbd {
  const base = generarMuestra(hoy);
  const fichas: FichaDeArticulo[] = FICHAS.map(([articuloId, categoria, juegoId, conLote, puntoDeReorden]) => ({ articuloId, categoria, juegoId, conLote, puntoDeReorden }));
  const articulos = base.articulos;
  const juego = (id: string) => JUEGOS.find((j) => j.id === fichas.find((f) => f.articuloId === id)?.juegoId);
  const costoBase = (id: string) => {
    const a = articulos.find((x) => x.id === id)!;
    return r2(precioBaseDe(a.costo, a.unidad, juego(id)));
  };
  const bs = bins();
  const existencias: Existencia[] = [];
  let k = 0;
  for (const f of fichas) {
    const cant = CANTIDADES[f.articuloId];
    SITIOS.forEach((s, si) => {
      const total = cant[si];
      if (!total) return;
      const binsDelSitio = bs.filter((b) => b.sitioId === s.id);
      if (f.conLote) {
        // Dos o tres lotes por sitio, cada uno con su fecha de caducidad.
        const partes = s.id === "s-cen" ? 3 : 2;
        let resta = total;
        for (let p = 0; p < partes; p++) {
          const q = p === partes - 1 ? resta : Math.max(1, Math.round(total / partes));
          resta -= q;
          if (q <= 0) continue;
          const off = CADUCIDADES[(k + p * 2) % CADUCIDADES.length];
          const recibido = sumaDias(hoy, Math.min(-10, off - 365));
          existencias.push({
            id: `x${++k}`, articuloId: f.articuloId, sitioId: s.id, binId: binsDelSitio[p % binsDelSitio.length]?.id ?? null,
            lote: `L${recibido.replace(/-/g, "").slice(2)}-${f.articuloId.slice(1)}${p}`, caduca: sumaDias(hoy, off), recibido, cantidad: q, costo: costoBase(f.articuloId),
          });
        }
      } else {
        // Parte acomodada y, en el central y McAllen, parte todavía en el andén para enseñar «acomodar».
        const enAnden = s.id === "s-cen" || s.id === "s-mca" ? Math.floor(total / 4) : 0;
        const bin = binsDelSitio[k % binsDelSitio.length]?.id ?? null;
        existencias.push({ id: `x${++k}`, articuloId: f.articuloId, sitioId: s.id, binId: bin, lote: null, caduca: null, recibido: sumaDias(hoy, -40), cantidad: total - enAnden, costo: costoBase(f.articuloId) });
        if (enAnden) existencias.push({ id: `x${++k}`, articuloId: f.articuloId, sitioId: s.id, binId: null, lote: null, caduca: null, recibido: sumaDias(hoy, -3), cantidad: enAnden, costo: costoBase(f.articuloId) });
      }
    });
  }

  const mes = inicioDeMes(hoy);
  const niveles: NivelDePrecio[] = [{ tipo: "contractor", porcentaje: -10 }, { tipo: "designer", porcentaje: -5 }, { tipo: "homeowner", porcentaje: 0 }];
  const reglas: ReglaDePrecio[] = [
    { id: "r1", nombre: "Setting materials sale this month", categoria: "setting", tipoCliente: null, desde: mes, hasta: sumaDias(mes, 40), minimo: 0, porcentaje: -15, activa: true },
    { id: "r2", nombre: "Pallet quantity on tile (30+ boxes)", categoria: "tile", tipoCliente: null, desde: null, hasta: null, minimo: 30, porcentaje: -14, activa: true },
    { id: "r3", nombre: "Homeowner spring promo (ended)", categoria: "tile", tipoCliente: "homeowner", desde: sumaDias(hoy, -200), hasta: sumaDias(hoy, -150), minimo: 0, porcentaje: -20, activa: true },
  ];

  // Órdenes de venta en McAllen: la loseta 24x48 (i01) no alcanza para todas, para enseñar el pendiente (backorder).
  const cli = (i: number) => base.clientes[i];
  const linea = (articuloId: string, cantidadEscrita: number, unidad: string, tipo: (typeof base.clientes)[number]["tipo"], fecha: string): LineaDeVenta => {
    const a = articulos.find((x) => x.id === articuloId)!;
    const j = juego(articuloId);
    const f = fichas.find((x) => x.articuloId === articuloId)!;
    const cantidad = Math.ceil(Math.round(cantidadEscrita * (j?.unidades.find((u) => u.u === unidad)?.factor ?? 1) * 10000) / 10000);
    const p = precioDeLinea({ lista: precioBaseDe(a.precio, a.unidad, j), categoria: f.categoria, tipoCliente: tipo, cantidad, fecha, niveles, reglas });
    return { articuloId, cantidad, unidad, cantidadEscrita, precio: p.precio, regla: p.ganador.clave, enviado: 0 };
  };
  const ov = (n: number, ci: number, dias: number, ls: [string, number, string][]): OrdenDeVenta => {
    const fecha = sumaDias(hoy, dias);
    return { id: `so${n}`, numero: `SO-${5100 + n}`, clienteId: cli(ci).id, sitioId: "s-mca", fecha, cancelada: false, lineas: ls.map(([a, q, u]) => linea(a, q, u, cli(ci).tipo, fecha)) };
  };
  const ordenes: OrdenDeVenta[] = [
    ov(1, 0, -6, [["i01", 120, "sq ft"], ["i15", 6, "bag"], ["i24", 8, "piece"]]),
    ov(2, 3, -4, [["i01", 90, "sq ft"], ["i18", 2, "bag"]]),
    ov(3, 7, -2, [["i09", 60, "sq ft"], ["i19", 1, "bag"], ["i26", 12, "piece"]]),
    ov(4, 4, -1, [["i02", 620, "sq ft"], ["i15", 20, "bag"]]),
  ];
  // La primera ya mandó la moldura.
  ordenes[0] = { ...ordenes[0], lineas: ordenes[0].lineas.map((l) => (l.articuloId === "i24" ? { ...l, enviado: l.cantidad } : l)) };

  const kits: Kit[] = [
    { id: "k1", sku: "KIT-SHWR-WHT", nombre: "Shower kit · white subway", precio: 449, componentes: [{ articuloId: "i09", cantidad: 6 }, { articuloId: "i15", cantidad: 3 }, { articuloId: "i19", cantidad: 1 }, { articuloId: "i23", cantidad: 1 }, { articuloId: "i24", cantidad: 4 }] },
    { id: "k2", sku: "KIT-FLR-GRY", nombre: "Floor kit · 24x24 gray, 200 sq ft", precio: 899, componentes: [{ articuloId: "i02", cantidad: 13 }, { articuloId: "i15", cantidad: 5 }, { articuloId: "i18", cantidad: 2 }, { articuloId: "i26", cantidad: 10 }] },
  ];

  const alternos: ProveedorAlterno[] = [];
  for (const f of fichas) {
    const a = articulos.find((x) => x.id === f.articuloId)!;
    const c = costoBase(a.id);
    if (a.proveedorId) alternos.push({ articuloId: a.id, proveedorId: a.proveedorId, costo: c, dias: 5 });
    if (f.categoria === "tile") alternos.push({ articuloId: a.id, proveedorId: a.proveedorId === "v1" ? "v2" : "v1", costo: r2(c * 0.92), dias: 21 });
    if (f.categoria === "trim") alternos.push({ articuloId: a.id, proveedorId: "v1", costo: r2(c * 1.06), dias: 2 });
  }

  const ordenesCompra = base.ordenes.filter((o) => o.lineas.some((l) => l.recibido > 0));

  return {
    version: 1, generado: hoy,
    articulos, clientes: base.clientes, proveedores: base.proveedores, ordenesCompra,
    fichas, juegos: JUEGOS, sitios: SITIOS, bins: bs, existencias,
    traspasos: [], ordenes, envios: [], kits, armados: [], niveles, reglas,
    importaciones: [], alternos, reordenes: [],
  };
}
