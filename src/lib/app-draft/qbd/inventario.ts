/**
 * App Draft · QuickBooks Desktop: las cuentas puras del inventario avanzado (sin React, para vitest). Cada operación que
 * mueve mercancía recibe el estado y devuelve uno nuevo, o un error en palabras llanas; nunca muta.
 */
import { diasEntre, r2, sumaDias } from "../qbo/contabilidad";
import type { TipoDeCliente } from "../qbo/tipos";
import type {
  Categoria, CostoDeImportacion, Envio, EstadoQbd, Existencia, JuegoDeUnidades, Kit, LineaDeTraspaso, NivelDePrecio,
  OrdenDeVenta, ProveedorAlterno, ReglaDePrecio, Toma, Traspaso,
} from "./tipos";

export { r2, sumaDias, diasEntre };

const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

// ---------------------------------------------------------------- unidades de medida

/** Cuántas unidades base vale una `u` (1 si la unidad no está en el juego). */
export function factorDe(juego: JuegoDeUnidades | undefined, u: string): number {
  return juego?.unidades.find((x) => x.u === u)?.factor ?? 1;
}

/**
 * Pasa una cantidad escrita en `u` a unidad base. La existencia se cuenta en piezas enteras de la base (cajas, bolsas):
 * se redondea HACIA ARRIBA, porque no se vende media caja (200 ft² de una loseta de 15.5 ft²/caja = 13 cajas).
 */
export function aBase(cantidad: number, u: string, juego: JuegoDeUnidades | undefined): number {
  const v = cantidad * factorDe(juego, u);
  return Math.ceil(r4(v));
}

/** De unidad base a `u`, con dos decimales. */
export function deBase(cantidad: number, u: string, juego: JuegoDeUnidades | undefined): number {
  return r2(cantidad / factorDe(juego, u));
}

/** Precio de lista por unidad base: el de QBO viene en su propia unidad (ft², bolsa, pieza). */
export function precioBaseDe(precio: number, unidadDelPrecio: string, juego: JuegoDeUnidades | undefined): number {
  return r4(precio / factorDe(juego, unidadDelPrecio));
}

// ---------------------------------------------------------------- existencia, apartados y primeras caducidades

export function vigente(x: Existencia, hoy: string): boolean {
  return !x.caduca || x.caduca >= hoy;
}

/** Existencia en mano (unidad base). Sin `sitioId`, la de todos los sitios. */
export function enMano(existencias: readonly Existencia[], articuloId: string, sitioId?: string): number {
  return existencias.reduce((a, x) => a + (x.articuloId === articuloId && (!sitioId || x.sitioId === sitioId) ? x.cantidad : 0), 0);
}

/** La existencia menos lo apartado por listas de surtido que aún no salen del estante. */
export function existenciasLibres(e: Pick<EstadoQbd, "existencias" | "envios">): Existencia[] {
  const apartado = new Map<string, number>();
  for (const en of e.envios) {
    if (en.estado !== "picking") continue;
    for (const l of en.lineas) for (const t of l.tomas) apartado.set(t.existenciaId, (apartado.get(t.existenciaId) ?? 0) + t.cantidad);
  }
  return e.existencias.map((x) => ({ ...x, cantidad: x.cantidad - (apartado.get(x.id) ?? 0) })).filter((x) => x.cantidad > 0);
}

/** Lo que se puede prometer hoy: libre y sin caducar. */
export function disponible(e: Pick<EstadoQbd, "existencias" | "envios">, articuloId: string, sitioId: string, hoy: string): number {
  return existenciasLibres(e).reduce((a, x) => a + (x.articuloId === articuloId && x.sitioId === sitioId && vigente(x, hoy) ? x.cantidad : 0), 0);
}

/**
 * Sugerencia de qué lote y ubicación tomar: primero lo que caduca antes, luego lo que entró antes (primeras entradas,
 * primeras salidas). Salta lo caducado. Devuelve las tomas y lo que falta si no alcanza.
 */
export function sugerirTomas(existencias: readonly Existencia[], articuloId: string, sitioId: string, cantidad: number, hoy: string): { tomas: Toma[]; falta: number } {
  const filas = existencias
    .filter((x) => x.articuloId === articuloId && x.sitioId === sitioId && x.cantidad > 0 && vigente(x, hoy))
    .sort((a, b) => (a.caduca ?? "9999") .localeCompare(b.caduca ?? "9999") || a.recibido.localeCompare(b.recibido) || a.id.localeCompare(b.id));
  const tomas: Toma[] = [];
  let resta = cantidad;
  for (const x of filas) {
    if (resta <= 0) break;
    const c = Math.min(resta, x.cantidad);
    tomas.push({ existenciaId: x.id, cantidad: c });
    resta -= c;
  }
  return { tomas, falta: Math.max(0, resta) };
}

/** Descuenta las tomas de la existencia (quita los renglones que quedan en cero). */
export function descontar(existencias: readonly Existencia[], tomas: readonly Toma[]): Existencia[] {
  const menos = new Map<string, number>();
  for (const t of tomas) menos.set(t.existenciaId, (menos.get(t.existenciaId) ?? 0) + t.cantidad);
  return existencias.map((x) => ({ ...x, cantidad: x.cantidad - (menos.get(x.id) ?? 0) })).filter((x) => x.cantidad > 0);
}

// ---------------------------------------------------------------- traspasos entre sitios

export type Resultado = { ok: true; e: EstadoQbd } | { ok: false; error: string };

/** Crea un traspaso: la mercancía sale del origen (por primeras caducidades) y queda «en camino». */
export function crearTraspaso(e: EstadoQbd, t: { id: string; numero: string; origenId: string; destinoId: string; fecha: string; lineas: { articuloId: string; cantidad: number }[] }, hoy: string): Resultado {
  if (!t.origenId || !t.destinoId || t.origenId === t.destinoId) return { ok: false, error: "same-site" };
  const lineas = t.lineas.filter((l) => l.articuloId && l.cantidad > 0);
  if (!lineas.length) return { ok: false, error: "no-lines" };
  let libres = existenciasLibres(e);
  let existencias = e.existencias;
  const salida: LineaDeTraspaso[] = [];
  for (const l of lineas) {
    const s = sugerirTomas(libres, l.articuloId, t.origenId, l.cantidad, hoy);
    if (s.falta > 0) return { ok: false, error: `short:${l.articuloId}:${l.cantidad - s.falta}` };
    for (const tm of s.tomas) {
      const x = e.existencias.find((y) => y.id === tm.existenciaId)!;
      salida.push({ articuloId: x.articuloId, cantidad: tm.cantidad, lote: x.lote, caduca: x.caduca, recibido: x.recibido, costo: x.costo });
    }
    libres = descontar(libres, s.tomas);
    existencias = descontar(existencias, s.tomas);
  }
  const nuevo: Traspaso = { id: t.id, numero: t.numero, origenId: t.origenId, destinoId: t.destinoId, fecha: t.fecha, lineas: salida, estado: "in_transit", recibidoEl: null };
  return { ok: true, e: { ...e, existencias, traspasos: [...e.traspasos, nuevo] } };
}

/** Recibe un traspaso en el destino: entra al andén (sin ubicación), con su lote y caducidad. */
export function recibirTraspaso(e: EstadoQbd, id: string, fecha: string): EstadoQbd {
  const t = e.traspasos.find((x) => x.id === id);
  if (!t || t.estado !== "in_transit") return e;
  const entra: Existencia[] = t.lineas.map((l, i) => ({
    id: `${t.id}-in${i}`, articuloId: l.articuloId, sitioId: t.destinoId, binId: null, lote: l.lote, caduca: l.caduca, recibido: l.recibido, cantidad: l.cantidad, costo: l.costo,
  }));
  return { ...e, existencias: [...e.existencias, ...entra], traspasos: e.traspasos.map((x) => (x.id === id ? { ...x, estado: "received", recibidoEl: fecha } : x)) };
}

export function enCamino(e: Pick<EstadoQbd, "traspasos">, articuloId: string, destinoId?: string): number {
  return e.traspasos.reduce((a, t) => a + (t.estado === "in_transit" && (!destinoId || t.destinoId === destinoId) ? t.lineas.reduce((b, l) => b + (l.articuloId === articuloId ? l.cantidad : 0), 0) : 0), 0);
}

// ---------------------------------------------------------------- ubicaciones (bins)

/** Acomoda (o mueve) parte de un renglón a otra ubicación del mismo sitio. */
export function acomodar(e: EstadoQbd, existenciaId: string, binId: string, cantidad: number, nuevoId: string): Resultado {
  const x = e.existencias.find((y) => y.id === existenciaId);
  const bin = e.bins.find((b) => b.id === binId);
  if (!x || !bin) return { ok: false, error: "not-found" };
  if (bin.sitioId !== x.sitioId) return { ok: false, error: "other-site" };
  const libre = existenciasLibres(e).find((y) => y.id === existenciaId)?.cantidad ?? 0;
  if (cantidad <= 0 || cantidad > libre) return { ok: false, error: "qty" };
  if (x.binId === binId) return { ok: false, error: "same-bin" };
  // Si ya hay un renglón igual (mismo lote, costo, fecha) en esa ubicación, se suma ahí.
  const igual = e.existencias.find((y) => y.id !== x.id && y.articuloId === x.articuloId && y.sitioId === x.sitioId && y.binId === binId && y.lote === x.lote && y.caduca === x.caduca && y.costo === x.costo && y.recibido === x.recibido);
  let existencias = e.existencias.map((y) => (y.id === x.id ? { ...y, cantidad: y.cantidad - cantidad } : y));
  existencias = igual
    ? existencias.map((y) => (y.id === igual.id ? { ...y, cantidad: y.cantidad + cantidad } : y))
    : [...existencias, { ...x, id: nuevoId, binId, cantidad }];
  return { ok: true, e: { ...e, existencias: existencias.filter((y) => y.cantidad > 0) } };
}

// ---------------------------------------------------------------- lotes y caducidad

export type TramoDeCaducidad = "expired" | "d30" | "d60" | "d90";

export function tramoDeCaducidad(caduca: string, hoy: string): TramoDeCaducidad | null {
  const d = diasEntre(hoy, caduca);
  if (d < 0) return "expired";
  if (d <= 30) return "d30";
  if (d <= 60) return "d60";
  if (d <= 90) return "d90";
  return null;
}

/** Lotes con caducidad dentro de `dias` (y los ya caducados), del que vence antes al que vence después. */
export function caducanPronto(existencias: readonly Existencia[], hoy: string, dias: number) {
  return existencias
    .filter((x) => x.caduca && x.cantidad > 0 && diasEntre(hoy, x.caduca) <= dias)
    .map((x) => ({ ...x, dias: diasEntre(hoy, x.caduca!), tramo: tramoDeCaducidad(x.caduca!, hoy)! }))
    .sort((a, b) => a.dias - b.dias || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- órdenes de venta y surtido

/** Lo que está en una lista de surtido aún no enviada. */
export function enLista(envios: readonly Envio[], ordenId: string, articuloId: string): number {
  return envios.reduce((a, en) => a + (en.ordenId === ordenId && en.estado !== "shipped" ? en.lineas.reduce((b, l) => b + (l.articuloId === articuloId ? l.cantidad : 0), 0) : 0), 0);
}

/** Lo que falta por mandar a surtir de un renglón. */
export function porSurtir(o: OrdenDeVenta, envios: readonly Envio[], articuloId: string): number {
  const l = o.lineas.find((x) => x.articuloId === articuloId);
  if (!l) return 0;
  return Math.max(0, l.cantidad - l.enviado - enLista(envios, o.id, articuloId));
}

export type EstadoDeOrdenVenta = "open" | "partial" | "shipped" | "cancelled";

export function estadoDeOrdenVenta(o: OrdenDeVenta, envios: readonly Envio[]): EstadoDeOrdenVenta {
  if (o.cancelada) return "cancelled";
  if (o.lineas.every((l) => l.enviado >= l.cantidad)) return "shipped";
  const algo = o.lineas.some((l) => l.enviado > 0) || envios.some((en) => en.ordenId === o.id);
  return algo ? "partial" : "open";
}

export function totalDeOrdenVenta(o: Pick<OrdenDeVenta, "lineas">): number {
  return r2(o.lineas.reduce((a, l) => a + l.cantidad * l.precio, 0));
}

export interface FilaDeHoja {
  ordenId: string;
  numero: string;
  clienteId: string;
  fecha: string;
  sitioId: string;
  articuloId: string;
  pendiente: number;
  /** Cuánto le toca si se surte por antigüedad. */
  sugerido: number;
  /** Lo que se queda pendiente (backorder) después de lo sugerido. */
  backorder: number;
}

/**
 * Hoja de «qué órdenes surtir»: cada renglón pendiente de cada orden abierta, con lo disponible repartido de la orden más
 * vieja a la más nueva (por sitio y artículo). Cuando no alcanza, lo que no cabe queda como pendiente (backorder).
 */
export function hojaDeSurtido(e: Pick<EstadoQbd, "existencias" | "envios" | "ordenes">, hoy: string): FilaDeHoja[] {
  const bolsa = new Map<string, number>();
  const filas: FilaDeHoja[] = [];
  const ordenes = e.ordenes.filter((o) => !o.cancelada).slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero));
  for (const o of ordenes) {
    for (const l of o.lineas) {
      const pendiente = porSurtir(o, e.envios, l.articuloId);
      if (pendiente <= 0) continue;
      const k = `${o.sitioId}|${l.articuloId}`;
      if (!bolsa.has(k)) bolsa.set(k, disponible(e, l.articuloId, o.sitioId, hoy));
      const hay = bolsa.get(k)!;
      const sugerido = Math.min(pendiente, hay);
      bolsa.set(k, hay - sugerido);
      filas.push({ ordenId: o.id, numero: o.numero, clienteId: o.clienteId, fecha: o.fecha, sitioId: o.sitioId, articuloId: l.articuloId, pendiente, sugerido, backorder: pendiente - sugerido });
    }
  }
  return filas;
}

/** Crea una lista de surtido para una orden con las cantidades elegidas; aparta lote y ubicación por caducidad. */
export function crearEnvio(e: EstadoQbd, p: { id: string; numero: string; ordenId: string; fecha: string; cantidades: Record<string, number> }, hoy: string): Resultado {
  const o = e.ordenes.find((x) => x.id === p.ordenId);
  if (!o || o.cancelada) return { ok: false, error: "not-found" };
  let libres = existenciasLibres(e);
  const lineas: Envio["lineas"] = [];
  for (const [articuloId, cant] of Object.entries(p.cantidades)) {
    if (!(cant > 0)) continue;
    if (cant > porSurtir(o, e.envios, articuloId)) return { ok: false, error: `over-order:${articuloId}` };
    const s = sugerirTomas(libres, articuloId, o.sitioId, cant, hoy);
    if (s.falta > 0) return { ok: false, error: `short:${articuloId}:${cant - s.falta}` };
    libres = descontar(libres, s.tomas);
    lineas.push({ articuloId, cantidad: cant, tomas: s.tomas, escaneado: 0 });
  }
  if (!lineas.length) return { ok: false, error: "no-lines" };
  const en: Envio = { id: p.id, numero: p.numero, ordenId: o.id, fecha: p.fecha, lineas, estado: "picking" };
  return { ok: true, e: { ...e, envios: [...e.envios, en] } };
}

/**
 * Escaneo simulado: el código escrito o pegado (SKU) cuenta `cantidad` en su renglón. Devuelve el artículo reconocido
 * o un error si el código no es de esta lista o ya se escaneó todo.
 */
export function escanear(e: EstadoQbd, envioId: string, codigo: string, cantidad: number, skuDe: (articuloId: string) => string): { e: EstadoQbd; articuloId: string | null; error: "unknown" | "complete" | null } {
  const en = e.envios.find((x) => x.id === envioId);
  const c = codigo.trim().toUpperCase();
  const l = en?.lineas.find((x) => skuDe(x.articuloId).toUpperCase() === c);
  if (!en || en.estado !== "picking" || !l) return { e, articuloId: null, error: "unknown" };
  if (l.escaneado >= l.cantidad) return { e, articuloId: l.articuloId, error: "complete" };
  const suma = Math.min(l.cantidad, l.escaneado + Math.max(1, Math.floor(cantidad)));
  return {
    e: { ...e, envios: e.envios.map((x) => (x.id !== envioId ? x : { ...x, lineas: x.lineas.map((y) => (y.articuloId === l.articuloId ? { ...y, escaneado: suma } : y)) })) },
    articuloId: l.articuloId, error: null,
  };
}

/** Avanza el envío: surtido (exige todo escaneado y descuenta la existencia) → empacado → enviado (cuenta en la orden). */
export function avanzarEnvio(e: EstadoQbd, envioId: string): Resultado {
  const en = e.envios.find((x) => x.id === envioId);
  if (!en) return { ok: false, error: "not-found" };
  if (en.estado === "picking") {
    if (en.lineas.some((l) => l.escaneado < l.cantidad)) return { ok: false, error: "not-scanned" };
    const tomas = en.lineas.flatMap((l) => l.tomas);
    return { ok: true, e: { ...e, existencias: descontar(e.existencias, tomas), envios: e.envios.map((x) => (x.id === en.id ? { ...x, estado: "picked" } : x)) } };
  }
  if (en.estado === "picked") return { ok: true, e: { ...e, envios: e.envios.map((x) => (x.id === en.id ? { ...x, estado: "packed" } : x)) } };
  if (en.estado === "packed") {
    const sumado = (articuloId: string) => en.lineas.reduce((a, l) => a + (l.articuloId === articuloId ? l.cantidad : 0), 0);
    return {
      ok: true,
      e: {
        ...e,
        envios: e.envios.map((x) => (x.id === en.id ? { ...x, estado: "shipped" } : x)),
        ordenes: e.ordenes.map((o) => (o.id !== en.ordenId ? o : { ...o, lineas: o.lineas.map((l) => ({ ...l, enviado: Math.min(l.cantidad, l.enviado + sumado(l.articuloId)) })) })),
      },
    };
  }
  return { ok: false, error: "shipped" };
}

/** Cancela una lista que aún no sale del estante: libera lo apartado. */
export function cancelarEnvio(e: EstadoQbd, envioId: string): EstadoQbd {
  const en = e.envios.find((x) => x.id === envioId);
  if (!en || en.estado !== "picking") return e;
  return { ...e, envios: e.envios.filter((x) => x.id !== envioId) };
}

// ---------------------------------------------------------------- kits (armados)

/** Costo de un kit con el costo promedio de cada componente. */
export function costoDeKit(kit: Pick<Kit, "componentes">, costoDe: (articuloId: string) => number): number {
  return r2(kit.componentes.reduce((a, c) => a + c.cantidad * costoDe(c.articuloId), 0));
}

/** Costo promedio por unidad base de lo que hay en mano (o el costo de lista si no hay). */
export function costoPromedio(existencias: readonly Existencia[], articuloId: string, respaldo: number): number {
  let q = 0, v = 0;
  for (const x of existencias) if (x.articuloId === articuloId) { q += x.cantidad; v += x.cantidad * x.costo; }
  return q > 0 ? r4(v / q) : respaldo;
}

/** Cuántos kits se pueden armar en un sitio con lo libre. */
export function maximoArmable(e: Pick<EstadoQbd, "existencias" | "envios">, kit: Pick<Kit, "componentes">, sitioId: string, hoy: string): number {
  if (!kit.componentes.length) return 0;
  return Math.min(...kit.componentes.map((c) => Math.floor(disponible(e, c.articuloId, sitioId, hoy) / c.cantidad)));
}

/** Arma kits: consume los componentes (primeras caducidades) y mete los kits al andén con el costo real consumido. */
export function armarKit(e: EstadoQbd, p: { id: string; kitId: string; sitioId: string; cantidad: number; fecha: string }, hoy: string): Resultado {
  const kit = e.kits.find((k) => k.id === p.kitId);
  if (!kit || !(p.cantidad > 0) || !Number.isInteger(p.cantidad)) return { ok: false, error: "qty" };
  let libres = existenciasLibres(e);
  let existencias = e.existencias;
  let costo = 0;
  for (const c of kit.componentes) {
    const s = sugerirTomas(libres, c.articuloId, p.sitioId, c.cantidad * p.cantidad, hoy);
    if (s.falta > 0) return { ok: false, error: `short:${c.articuloId}:${c.cantidad * p.cantidad - s.falta}` };
    for (const t of s.tomas) costo += t.cantidad * e.existencias.find((x) => x.id === t.existenciaId)!.costo;
    libres = descontar(libres, s.tomas);
    existencias = descontar(existencias, s.tomas);
  }
  const unitario = r2(costo / p.cantidad);
  const entra: Existencia = { id: `${p.id}-kit`, articuloId: kit.id, sitioId: p.sitioId, binId: null, lote: null, caduca: null, recibido: p.fecha, cantidad: p.cantidad, costo: unitario };
  return { ok: true, e: { ...e, existencias: [...existencias, entra], armados: [...e.armados, { id: p.id, kitId: kit.id, sitioId: p.sitioId, cantidad: p.cantidad, fecha: p.fecha, costoUnitario: unitario }] } };
}

// ---------------------------------------------------------------- niveles y reglas de precio

export interface Candidato {
  clave: string;
  etiqueta_en: string;
  etiqueta_es: string;
  porcentaje: number;
  precio: number;
}

export function reglaAplica(r: ReglaDePrecio, p: { categoria: Categoria; tipoCliente: TipoDeCliente; cantidad: number; fecha: string }): boolean {
  if (!r.activa) return false;
  if (r.categoria && r.categoria !== p.categoria) return false;
  if (r.tipoCliente && r.tipoCliente !== p.tipoCliente) return false;
  if (r.desde && p.fecha < r.desde) return false;
  if (r.hasta && p.fecha > r.hasta) return false;
  return p.cantidad >= r.minimo;
}

const TIPOS: Record<TipoDeCliente, [string, string]> = { contractor: ["Contractor", "Contratista"], homeowner: ["Homeowner", "Dueño de casa"], designer: ["Designer", "Diseñador"] };
export function nombreDeTipo(t: TipoDeCliente, lang: (en: string, es: string) => string): string {
  return lang(TIPOS[t][0], TIPOS[t][1]);
}

/**
 * El precio de un renglón: compite el precio de lista, el nivel del tipo de cliente y cada regla que aplique (categoría,
 * fechas, cantidad mínima). Gana el MÁS BAJO para el cliente; en empate, el primero (lista → nivel → reglas en orden).
 * Devuelve el ganador y todos los candidatos, para enseñar por qué.
 */
export function precioDeLinea(p: { lista: number; categoria: Categoria; tipoCliente: TipoDeCliente; cantidad: number; fecha: string; niveles: readonly NivelDePrecio[]; reglas: readonly ReglaDePrecio[] }): { precio: number; ganador: Candidato; candidatos: Candidato[] } {
  const con = (pct: number) => r4(p.lista * (1 + pct / 100));
  const candidatos: Candidato[] = [{ clave: "list", etiqueta_en: "List price", etiqueta_es: "Precio de lista", porcentaje: 0, precio: con(0) }];
  const nivel = p.niveles.find((n) => n.tipo === p.tipoCliente);
  if (nivel && nivel.porcentaje !== 0) {
    candidatos.push({ clave: `level:${nivel.tipo}`, etiqueta_en: `${TIPOS[nivel.tipo][0]} level`, etiqueta_es: `Nivel ${TIPOS[nivel.tipo][1].toLowerCase()}`, porcentaje: nivel.porcentaje, precio: con(nivel.porcentaje) });
  }
  for (const r of p.reglas) if (reglaAplica(r, p)) candidatos.push({ clave: `rule:${r.id}`, etiqueta_en: r.nombre, etiqueta_es: r.nombre, porcentaje: r.porcentaje, precio: con(r.porcentaje) });
  let ganador = candidatos[0];
  for (const c of candidatos) if (c.precio < ganador.precio) ganador = c;
  return { precio: ganador.precio, ganador, candidatos };
}

// ---------------------------------------------------------------- costo de importación (landed cost)

export interface RepartoDeCosto {
  articuloId: string;
  cantidad: number;
  costo: number;
  extra: number;
  nuevoCosto: number;
}

/**
 * Reparte flete y aranceles entre los renglones recibidos de una orden, por valor (lo caro carga más) o por cantidad.
 * Los centavos que sobran del redondeo van al último renglón, para que el reparto sume exacto.
 */
export function repartirCosto(lineas: readonly { articuloId: string; cantidad: number; costo: number }[], monto: number, metodo: CostoDeImportacion["metodo"]): RepartoDeCosto[] {
  const buenas = lineas.filter((l) => l.cantidad > 0);
  const peso = (l: { cantidad: number; costo: number }) => (metodo === "value" ? l.cantidad * l.costo : l.cantidad);
  const total = buenas.reduce((a, l) => a + peso(l), 0);
  let usado = 0;
  return buenas.map((l, i) => {
    const extra = i === buenas.length - 1 ? r2(monto - usado) : r2(total > 0 ? (monto * peso(l)) / total : 0);
    usado = r2(usado + extra);
    return { articuloId: l.articuloId, cantidad: l.cantidad, costo: l.costo, extra, nuevoCosto: r4(l.costo + extra / l.cantidad) };
  });
}

// ---------------------------------------------------------------- proveedores alternos y reorden

export function mejorProveedor(alternos: readonly ProveedorAlterno[], articuloId: string, criterio: "cost" | "speed"): ProveedorAlterno | null {
  const xs = alternos.filter((a) => a.articuloId === articuloId);
  if (!xs.length) return null;
  return xs.slice().sort((a, b) => (criterio === "cost" ? a.costo - b.costo || a.dias - b.dias : a.dias - b.dias || a.costo - b.costo))[0];
}

/** Artículos cuya existencia total (más lo ya pedido en reorden) está por debajo de su punto de reorden. */
export function porReordenar(e: Pick<EstadoQbd, "fichas" | "existencias" | "reordenes">) {
  return e.fichas
    .filter((f) => f.puntoDeReorden > 0)
    .map((f) => {
      const mano = enMano(e.existencias, f.articuloId);
      const pedido = e.reordenes.reduce((a, r) => a + (r.articuloId === f.articuloId ? r.cantidad : 0), 0);
      return { articuloId: f.articuloId, mano, pedido, punto: f.puntoDeReorden, sugerido: Math.max(0, f.puntoDeReorden * 2 - mano - pedido) };
    })
    .filter((x) => x.mano + x.pedido < x.punto);
}
