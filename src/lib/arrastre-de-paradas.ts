import { costeDeLaRuta, mejorLugar, type LatLng, type ParadaDeRuta } from "@/lib/mejor-lugar";

/**
 * Arrastrar paradas en la línea de tiempo («📅 Horario») del Gestor de Rutas (D-417), como el «drag and drop» de
 * OptimoRoute. Aquí vive TODO lo que decide: qué hueco hay bajo el puntero, qué se escribe al soltar, cuánto cuesta
 * (vista previa), qué deja el candado, y el historial de deshacer/rehacer con su comprobación de choques. La pantalla
 * (`GanttTimeline` + `routes/page.tsx`) solo mide el puntero y llama.
 *
 * **Qué se escribe es lo mismo que escriben las flechas** (`move` de la pantalla, D-007): la secuencia entera de la ruta de
 * destino (`route_seq` 0..n-1 con `reorderStops`) y, si hace falta, el viaje de cada parada (`load_no`: `null` el primero).
 * Si la parada cambia de chofer, antes se le escribe a ella `assigned_driver`, su `route_seq` y su `load_no`, como hace
 * «📍 Mejor lugar» (D-411). La ruta de la que sale no se reescribe: sus paradas se quedan como estaban.
 *
 * **Cuándo se escriben viajes.** En una ruta con viajes puestos a mano (`manual`), siempre. En una ruta que parte la
 * capacidad sola (`splitIntoTrips`) solo si volver a partirla NO daría los viajes que la persona acaba de dibujar (p. ej.
 * pasar la primera parada al segundo viaje): entonces se fijan los viajes, como hace «mover de viaje» (`moveStopToLoad`).
 * Si partirla da lo mismo, se escribe solo la secuencia, y la ruta sigue partiéndose sola.
 */

export interface ParadaDelGantt extends ParadaDeRuta {
  assigned_driver: string | null;
  route_seq: number | null;
  load_no: number | null;
}

export interface RutaDelGantt {
  /** La clave de ruta del Gestor: el nombre del chofer o de la ruta temporal. */
  clave: string;
  /** Los viajes tal como los pinta la pantalla (`buildTrips`). */
  viajes: readonly (readonly ParadaDelGantt[])[];
  /** `hasManualLoads`: la ruta lleva viajes puestos (por una persona o por Optimizar). */
  manual: boolean;
  capacidad: number;
  bloqueada: boolean;
  /** La recogida / base, para la estimación en línea recta. `null`: ruta abierta. */
  base: LatLng | null;
}

export type Destino =
  /** Soltar dentro de la fila de un chofer: en ese viaje y ese puesto (contados SIN la parada que se arrastra). */
  | { tipo: "hueco"; ruta: string; viaje: number; puesto: number }
  /** Soltar sobre el NOMBRE del chofer: «📍 Mejor lugar» decide el hueco. */
  | { tipo: "nombre"; ruta: string };

export interface EstadoDeParada { assigned_driver: string | null; route_seq: number | null; load_no: number | null }
/** Los campos de ruta de cada parada tocada, por id. */
export type Foto = Record<string, EstadoDeParada>;

export interface Previa {
  /** Millas de la ruta (o de las dos rutas) después menos antes. Puede ser negativo. */
  millasExtra: number;
  /** Minutos tarde después menos antes, sumando todas las paradas. Puede ser negativo. */
  tardeExtraMin: number;
  /** Las paradas que llegan MÁS tarde que antes a su ventana (la ventana que se rompe o empeora). */
  rotas: string[];
}

export type MotivoDeNoSoltar = "no_esta" | "bloqueada" | "no_cabe" | "sin_cambio" | "sin_punto";

export type PlanDeSoltar =
  | {
    ok: true;
    movida: string;
    origen: string;
    destino: string;
    /** Dónde queda, contado en los viajes de destino ya con ella dentro. */
    viaje: number;
    puesto: number;
    nuevoViaje: boolean;
    porNombre: boolean;
    /** Lo que se escribe: la secuencia entera del destino, y los viajes si hacen falta. */
    ids: string[];
    loadNoById?: Record<string, number | null>;
    /** Lo que se escribe antes a la parada que cambia de chofer (sin cambio de chofer, no hace falta). */
    parcheDeLaMovida: EstadoDeParada;
    antes: Foto;
    despues: Foto;
    previa: Previa;
    /** Cuántas paradas lleva el viaje donde entra, ella incluida (para el aviso). */
    totalDelViaje: number;
  }
  | { ok: false; motivo: MotivoDeNoSoltar };

export type Gesto = "arrastrar_desde" | "soltar_en_hueco" | "soltar_en_nombre";

/**
 * Qué deja hacer el candado 🔒 (D-411, D-414). Arrastrar una parada y soltarla EN UN SITIO es una edición a mano, como las
 * flechas ↑ ↓ y «Asignar», que D-411 dejó libres con candado («el candado protege de lo automático, no de quien
 * despacha»): se deja. Soltar sobre el NOMBRE es «📍 Mejor lugar», que elige el hueco solo y D-411 ya apaga con candado:
 * no se deja.
 */
export function candadoDeja(ruta: Pick<RutaDelGantt, "bloqueada">, gesto: Gesto): boolean {
  return !ruta.bloqueada || gesto !== "soltar_en_nombre";
}

/** Lo mismo que `splitIntoTrips` (dispatch.ts), sobre pallets ya contados: se llena un viaje hasta la capacidad. */
export function partePorCapacidad<T extends { pallets: number }>(paradas: readonly T[], capacidad: number): T[][] {
  const viajes: T[][] = [];
  let actual: T[] = [];
  let carga = 0;
  for (const p of paradas) {
    const n = p.pallets || 0;
    if (actual.length && carga + n > capacidad) { viajes.push(actual); actual = []; carga = 0; }
    actual.push(p);
    carga += n;
  }
  if (actual.length) viajes.push(actual);
  return viajes;
}

const palletsDe = (viaje: readonly { pallets: number }[]) => viaje.reduce((n, p) => n + (p.pallets || 0), 0);
const mismosViajes = (a: readonly (readonly { id: string }[])[], b: readonly (readonly { id: string }[])[]) =>
  a.length === b.length && a.every((v, i) => v.length === b[i].length && v.every((p, k) => p.id === b[i][k].id));

/** Los viajes de una ruta sin la parada que se arrastra; un viaje que se queda vacío desaparece (como en `groupIntoLoads`). */
export function viajesSinLaMovida<T extends { id: string }>(viajes: readonly (readonly T[])[], movida: string): T[][] {
  return viajes.map((v) => v.filter((p) => p.id !== movida)).filter((v) => v.length > 0);
}

/** Cómo quedará pintada la ruta con estos viajes: con viajes puestos, tal cual; si parte sola, partida de nuevo. */
const comoSePinta = <T extends ParadaDelGantt>(ruta: RutaDelGantt, viajes: T[][]): T[][] =>
  ruta.manual ? viajes : partePorCapacidad(viajes.flat(), ruta.capacidad);

const estadoDe = (p: ParadaDelGantt): EstadoDeParada => ({ assigned_driver: p.assigned_driver, route_seq: p.route_seq, load_no: p.load_no });

/** La foto de estas paradas, tal como están. */
export function fotoDe(paradas: readonly ParadaDelGantt[]): Foto {
  const f: Foto = {};
  for (const p of paradas) f[p.id] = estadoDe(p);
  return f;
}

/**
 * La foto después de `reorderStops(ids, loadNoById)`: cada id pasa a `route_seq` = su puesto, y a su viaje si se dan los
 * viajes. Lo que no está en `ids` no cambia. Es lo que escriben las flechas y lo que escribe soltar.
 * `desde` (D-433): el primer puesto, el mismo que se le dio a `reorderStops` (las flechas numeran tras lo ya hecho).
 */
export function fotoTrasReordenar(antes: Foto, ids: readonly string[], loadNoById?: Record<string, number | null>, desde = 0): Foto {
  const f: Foto = { ...antes };
  ids.forEach((id, i) => {
    const era = f[id] ?? { assigned_driver: null, route_seq: null, load_no: null };
    f[id] = { ...era, route_seq: desde + i, load_no: loadNoById ? (loadNoById[id] ?? null) : era.load_no };
  });
  return f;
}

/** Minutos tarde de cada parada, con el mismo reloj que «Mejor lugar» (`costeDeLaRuta`). */
function tardePorParada(viajes: readonly (readonly ParadaDeRuta[])[], base: LatLng | null, inicioMin: number) {
  const c = costeDeLaRuta(viajes, base, inicioMin);
  const tarde = new Map<string, number>();
  for (const v of viajes) for (const p of v) {
    const llega = c.llegadas.get(p.id);
    tarde.set(p.id, p.ventana && llega != null && llega > p.ventana[1] ? llega - p.ventana[1] : 0);
  }
  return { millas: c.millas, tardeMin: c.tardeMin, tarde };
}

/**
 * Qué pasa si se suelta `movida` en `destino`. No escribe nada: la pantalla lo llama en cada movimiento del puntero para
 * la vista previa, y otra vez al soltar para escribir. La estimación es la de «Mejor lugar» (línea recta × rodeo, sin
 * llamar a Google ni a OSRM).
 */
export function planDeSoltar(rutas: readonly RutaDelGantt[], movida: string, destino: Destino, inicioMin: number): PlanDeSoltar {
  const origen = rutas.find((r) => r.viajes.some((v) => v.some((p) => p.id === movida)));
  const dest = rutas.find((r) => r.clave === destino.ruta);
  if (!origen || !dest) return { ok: false, motivo: "no_esta" };
  const laMovida = origen.viajes.flat().find((p) => p.id === movida)!;
  if (!candadoDeja(origen, "arrastrar_desde")) return { ok: false, motivo: "bloqueada" };
  if (!candadoDeja(dest, destino.tipo === "nombre" ? "soltar_en_nombre" : "soltar_en_hueco")) return { ok: false, motivo: "bloqueada" };

  const sin = viajesSinLaMovida(dest.viajes, movida);
  let viaje: number;
  let puesto: number;
  if (destino.tipo === "nombre") {
    const r = mejorLugar({ viajes: sin, nueva: laMovida, base: dest.base, capacidad: dest.capacidad, inicioMin });
    if (!r.ok) return { ok: false, motivo: "sin_punto" };
    viaje = r.hueco.viaje;
    puesto = r.hueco.puesto;
  } else {
    viaje = destino.viaje;
    puesto = destino.puesto;
    if (viaje < 0 || viaje > sin.length || (viaje === sin.length && sin.length > 0)) return { ok: false, motivo: "no_esta" };
  }
  const nuevoViaje = viaje >= sin.length;
  if (!nuevoViaje && palletsDe(sin[viaje]) + (laMovida.pallets || 0) > dest.capacidad) return { ok: false, motivo: "no_cabe" };

  const nuevos: ParadaDelGantt[][] = sin.map((v) => [...v]);
  if (nuevoViaje) nuevos.push([laMovida]);
  else nuevos[viaje].splice(Math.max(0, Math.min(puesto, nuevos[viaje].length)), 0, laMovida);
  const puestoReal = nuevos[viaje].findIndex((p) => p.id === movida);

  if (origen.clave === dest.clave && mismosViajes(nuevos, dest.viajes)) return { ok: false, motivo: "sin_cambio" };

  const ids = nuevos.flat().map((p) => p.id);
  const fijaViajes = dest.manual || !mismosViajes(partePorCapacidad(nuevos.flat(), dest.capacidad), nuevos);
  let loadNoById: Record<string, number | null> | undefined;
  if (fijaViajes) {
    loadNoById = {};
    nuevos.forEach((v, i) => v.forEach((p) => { loadNoById![p.id] = i > 0 ? i + 1 : null; }));
  }
  const parcheDeLaMovida: EstadoDeParada = {
    assigned_driver: dest.clave,
    route_seq: ids.indexOf(movida),
    load_no: loadNoById ? loadNoById[movida] : null,
  };

  const tocadas = origen.clave === dest.clave ? origen.viajes.flat() : [...origen.viajes.flat(), ...dest.viajes.flat()];
  const antes = fotoDe(tocadas);
  const despues = fotoTrasReordenar({ ...antes, [movida]: { ...antes[movida], assigned_driver: dest.clave, load_no: loadNoById ? antes[movida].load_no : null } }, ids, loadNoById);

  // Vista previa: la ruta (o las dos) antes y después, como se van a pintar.
  const antesD = tardePorParada(dest.viajes, dest.base, inicioMin);
  const despuesD = tardePorParada(nuevos, dest.base, inicioMin);
  let millasExtra = despuesD.millas - antesD.millas;
  let tardeExtra = despuesD.tardeMin - antesD.tardeMin;
  const tardeAntes = new Map(antesD.tarde);
  const tardeDespues = new Map(despuesD.tarde);
  if (origen.clave !== dest.clave) {
    const antesO = tardePorParada(origen.viajes, origen.base, inicioMin);
    const despuesO = tardePorParada(comoSePinta(origen, viajesSinLaMovida(origen.viajes, movida)), origen.base, inicioMin);
    millasExtra += despuesO.millas - antesO.millas;
    tardeExtra += despuesO.tardeMin - antesO.tardeMin;
    for (const [id, m] of antesO.tarde) tardeAntes.set(id, m);
    for (const [id, m] of despuesO.tarde) tardeDespues.set(id, m);
  }
  const rotas = [...tardeDespues].filter(([id, m]) => m > (tardeAntes.get(id) ?? 0) + 0.5).map(([id]) => id);

  return {
    ok: true, movida, origen: origen.clave, destino: dest.clave, viaje, puesto: puestoReal, nuevoViaje,
    porNombre: destino.tipo === "nombre", ids, loadNoById, parcheDeLaMovida, antes, despues,
    previa: { millasExtra, tardeExtraMin: Math.round(tardeExtra), rotas },
    totalDelViaje: nuevos[viaje].length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// La línea de tiempo: dónde se pinta cada parada y qué hueco hay bajo el puntero.

export interface BarraDelGantt {
  id: string;
  viaje: number;
  puesto: number;
  /** Llegada estimada y fin de la descarga, en minutos desde medianoche. */
  llegadaMin: number;
  finMin: number;
  ventana: [number, number] | null;
  tardeMin: number;
}

/** Las barras de una ruta: cada parada en su hora ESTIMADA de llegada (el reloj de `costeDeLaRuta`), con su descarga. */
export function barrasDeLaRuta(viajes: readonly (readonly ParadaDeRuta[])[], base: LatLng | null, inicioMin: number): BarraDelGantt[] {
  const c = costeDeLaRuta(viajes, base, inicioMin);
  const out: BarraDelGantt[] = [];
  viajes.forEach((v, i) => v.forEach((p, k) => {
    const llega = c.llegadas.get(p.id) ?? inicioMin;
    out.push({
      id: p.id, viaje: i, puesto: k, llegadaMin: llega, finMin: llega + (p.servicioMin || 0), ventana: p.ventana,
      tardeMin: p.ventana && llega > p.ventana[1] ? Math.round(llega - p.ventana[1]) : 0,
    });
  }));
  return out;
}

export interface HuecoDeLaFila { viaje: number; puesto: number; /** Dónde se pinta el hueco, en minutos. */ min: number }

/**
 * Los huecos donde se puede soltar en una fila, contados SIN la parada que se arrastra (`sin`), y colocados donde la
 * persona los ve: antes de la primera de cada viaje, entre dos paradas (a mitad del espacio libre) y detrás de la última.
 * Una fila vacía tiene un hueco: el viaje 1, a la hora de salida.
 */
export function huecosDeLaFila(barras: readonly BarraDelGantt[], sin: string | null, inicioMin: number): HuecoDeLaFila[] {
  const porViaje = new Map<number, BarraDelGantt[]>();
  for (const b of barras) if (b.id !== sin) (porViaje.get(b.viaje) ?? porViaje.set(b.viaje, []).get(b.viaje)!).push(b);
  const viajes = [...porViaje.keys()].sort((a, b) => a - b).map((k) => porViaje.get(k)!);
  if (!viajes.length) return [{ viaje: 0, puesto: 0, min: inicioMin }];
  const out: HuecoDeLaFila[] = [];
  viajes.forEach((v, i) => {
    out.push({ viaje: i, puesto: 0, min: v[0].llegadaMin - 1 });
    for (let k = 1; k < v.length; k++) out.push({ viaje: i, puesto: k, min: (v[k - 1].finMin + v[k].llegadaMin) / 2 });
    out.push({ viaje: i, puesto: v.length, min: v[v.length - 1].finMin + 1 });
  });
  return out;
}

/** El hueco más cercano a la hora que hay bajo el puntero; a igual distancia, el primero. */
export function huecoMasCercano(huecos: readonly HuecoDeLaFila[], min: number): HuecoDeLaFila | null {
  let mejor: HuecoDeLaFila | null = null;
  for (const h of huecos) if (!mejor || Math.abs(h.min - min) < Math.abs(mejor.min - min)) mejor = h;
  return mejor;
}

// ---------------------------------------------------------------------------------------------------------------------
// Deshacer / rehacer. Deshacer es OTRA escritura en la base, no un paso atrás en la pantalla: antes de escribir se lee lo
// que hay ahora, y si alguien cambió algo de lo que se va a tocar, no se escribe nada.

export interface Movimiento {
  etiqueta: { en: string; es: string };
  /** Las rutas que tocó (una, o la de salida y la de llegada). */
  rutas: string[];
  antes: Foto;
  despues: Foto;
  /** `updated_at` de cada parada justo después de escribir (`null` si no se pudo leer). */
  sellos: Record<string, string> | null;
}
export interface Historial { deshacer: Movimiento[]; rehacer: Movimiento[] }
export const HISTORIAL_VACIO: Historial = { deshacer: [], rehacer: [] };
export const TOPE_DEL_HISTORIAL = 50;

/** Un movimiento nuevo: entra en «deshacer» y vacía «rehacer» (lo que se rehacía ya no sigue a esto). */
export function anota(h: Historial, m: Movimiento): Historial {
  return { deshacer: [...h.deshacer, m].slice(-TOPE_DEL_HISTORIAL), rehacer: [] };
}

export interface FilaFresca extends EstadoDeParada { id: string; updated_at?: string | null }
export type MotivoDeChoque = "ya_no_esta" | "cambio" | "editada" | "entro_otra";
export interface Choque { id: string; motivo: MotivoDeChoque }
export type Direccion = "deshacer" | "rehacer";

/** Lo que tiene que haber AHORA para poder volver: tras el movimiento (deshacer) o antes de él (rehacer). */
export const esperadoPara = (m: Movimiento, dir: Direccion): Foto => (dir === "deshacer" ? m.despues : m.antes);
/** Adonde se vuelve. */
export const objetivoDe = (m: Movimiento, dir: Direccion): Foto => (dir === "deshacer" ? m.antes : m.despues);

const igual = (a: EstadoDeParada, b: EstadoDeParada) =>
  (a.assigned_driver ?? null) === (b.assigned_driver ?? null) && (a.route_seq ?? null) === (b.route_seq ?? null) && (a.load_no ?? null) === (b.load_no ?? null);

/**
 * Por qué NO se puede deshacer (o rehacer) este movimiento ahora, o `[]` si se puede.
 * - `filas`: lo que hay en la base ahora mismo de las paradas del movimiento (leído al pulsar, no lo de la pantalla).
 * - `miembros`: las paradas que la pantalla tiene hoy en cada ruta del movimiento.
 * Choca si una parada ya no está, si sus campos de ruta no son los que dejó el movimiento, si su `updated_at` cambió
 * desde entonces (alguien la editó, aunque fuera otra cosa: se prefiere no pisar), o si entró otra parada en la ruta.
 */
export function choquesAlVolver(m: Movimiento, dir: Direccion, filas: readonly FilaFresca[], miembros: Record<string, readonly string[]>): Choque[] {
  const esperado = esperadoPara(m, dir);
  const porId = new Map(filas.map((f) => [f.id, f]));
  const out: Choque[] = [];
  for (const id of Object.keys(esperado)) {
    const f = porId.get(id);
    if (!f) { out.push({ id, motivo: "ya_no_esta" }); continue; }
    if (!igual(f, esperado[id])) { out.push({ id, motivo: "cambio" }); continue; }
    const sello = m.sellos?.[id];
    if (sello && f.updated_at && f.updated_at !== sello) out.push({ id, motivo: "editada" });
  }
  for (const ruta of m.rutas) {
    for (const id of miembros[ruta] ?? []) {
      if (!(id in esperado) || esperado[id].assigned_driver !== ruta) out.push({ id, motivo: "entro_otra" });
    }
  }
  return out;
}

/** Lo que hay que escribir para llevar `actual` a `objetivo`: solo las paradas y los campos que difieren. */
export function escriturasHacia(objetivo: Foto, actual: Foto): { id: string; parche: Partial<EstadoDeParada> }[] {
  const out: { id: string; parche: Partial<EstadoDeParada> }[] = [];
  for (const id of Object.keys(objetivo)) {
    const o = objetivo[id];
    const a = actual[id];
    const parche: Partial<EstadoDeParada> = {};
    if (!a || (a.assigned_driver ?? null) !== (o.assigned_driver ?? null)) parche.assigned_driver = o.assigned_driver;
    if (!a || (a.route_seq ?? null) !== (o.route_seq ?? null)) parche.route_seq = o.route_seq;
    if (!a || (a.load_no ?? null) !== (o.load_no ?? null)) parche.load_no = o.load_no;
    if (Object.keys(parche).length) out.push({ id, parche });
  }
  return out;
}

/** La foto de lo leído. */
export function fotoDeFilas(filas: readonly FilaFresca[]): Foto {
  const f: Foto = {};
  for (const x of filas) f[x.id] = { assigned_driver: x.assigned_driver ?? null, route_seq: x.route_seq ?? null, load_no: x.load_no ?? null };
  return f;
}

/** Los sellos de lo leído (las filas sin `updated_at` no se sellan). */
export function sellosDe(filas: readonly FilaFresca[] | null): Record<string, string> | null {
  if (!filas) return null;
  const s: Record<string, string> = {};
  for (const f of filas) if (f.updated_at) s[f.id] = f.updated_at;
  return s;
}

/** Tras deshacer (o rehacer) con éxito: el movimiento pasa a la otra pila, con los sellos nuevos. */
export function trasVolver(h: Historial, dir: Direccion, sellos: Record<string, string> | null): Historial {
  const de = dir === "deshacer" ? h.deshacer : h.rehacer;
  const m = de[de.length - 1];
  if (!m) return h;
  const movido = { ...m, sellos };
  return dir === "deshacer"
    ? { deshacer: h.deshacer.slice(0, -1), rehacer: [...h.rehacer, movido] }
    : { deshacer: [...h.deshacer, movido], rehacer: h.rehacer.slice(0, -1) };
}

/**
 * Tras un choque: ese movimiento ya no se puede aplicar sin pisar a otra persona, y sale de su pila. Los de debajo se
 * quedan: cada uno se vuelve a comprobar al pulsar, así que uno que dependía de este chocará también en vez de pisar.
 */
export function descartaElDeArriba(h: Historial, dir: Direccion): Historial {
  return dir === "deshacer" ? { ...h, deshacer: h.deshacer.slice(0, -1) } : { ...h, rehacer: h.rehacer.slice(0, -1) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Textos.

const mi = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n * 10) / 10).toFixed(1)} mi`;

/** La vista previa en una línea: millas y retraso de más, y qué ventanas rompe. `nombre` da la etiqueta de una parada. */
export function textoDePrevia(p: Previa, nombre: (id: string) => string): { en: string; es: string } {
  const tardeEn = p.tardeExtraMin > 0 ? `+${p.tardeExtraMin} min late` : p.tardeExtraMin < 0 ? `${p.tardeExtraMin} min late` : "no new lateness";
  const tardeEs = p.tardeExtraMin > 0 ? `+${p.tardeExtraMin} min tarde` : p.tardeExtraMin < 0 ? `${p.tardeExtraMin} min tarde` : "sin retrasos nuevos";
  const rotas = p.rotas.map((id) => `#${nombre(id)}`).join(", ");
  return {
    en: `${mi(p.millasExtra)} · ${tardeEn}${rotas ? ` · ⚠ breaks the window of ${rotas}` : ""}`,
    es: `${mi(p.millasExtra)} · ${tardeEs}${rotas ? ` · ⚠ rompe la ventana de ${rotas}` : ""}`,
  };
}

export function porQueNoSuelta(motivo: MotivoDeNoSoltar): { en: string; es: string } {
  switch (motivo) {
    case "bloqueada": return { en: "🔒 Locked route: Best fit doesn't touch it — drop it in a slot instead", es: "🔒 Ruta bloqueada: Mejor lugar no la toca — suéltela en un hueco" };
    case "no_cabe": return { en: "Doesn't fit: that truckload would go over capacity", es: "No cabe: ese viaje pasaría de la capacidad" };
    case "sin_punto": return { en: "No address pin: Best fit can't place it — drop it in a slot", es: "Sin pin de dirección: Mejor lugar no puede colocarla — suéltela en un hueco" };
    case "sin_cambio": return { en: "Same place", es: "Mismo sitio" };
    default: return { en: "Can't drop here", es: "No se puede soltar aquí" };
  }
}

export function textoDeChoques(choques: readonly Choque[], nombre: (id: string) => string, dir: Direccion): { en: string; es: string } {
  const ids = [...new Set(choques.map((c) => c.id))].map((id) => `#${nombre(id)}`).join(", ");
  const entro = choques.some((c) => c.motivo === "entro_otra");
  return {
    en: `${dir === "deshacer" ? "Not undone" : "Not redone"}: someone changed ${ids} after this move${entro ? " (another stop joined the route)" : ""}. Nothing was written, so their change stays.`,
    es: `${dir === "deshacer" ? "No se deshizo" : "No se rehízo"}: alguien cambió ${ids} después de este movimiento${entro ? " (entró otra parada en la ruta)" : ""}. No se escribió nada, así que su cambio se queda.`,
  };
}
