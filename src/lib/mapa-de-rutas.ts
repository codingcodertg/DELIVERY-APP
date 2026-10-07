import type { MapLine, MapPoint } from "@/components/MapView";
import { abanicoDeMarcas } from "@/lib/abanico-de-marcas";
import { horaReal } from "@/lib/hechas-del-gestor";
import { cuentaDePallets } from "@/lib/lista-unica";
import { driverOf } from "@/lib/route-lanes";
import type { LecturaDeRuta, OrdenAsignada } from "@/lib/route-plan/lectura-de-ruta";
import type { TripTrace } from "@/lib/usa-medida-de-rutas";
import { nombreEnElMapa } from "@/lib/gestor/nombre-en-el-mapa";
import { paradasDeLaRuta, textoDeLaParada } from "@/lib/gestor/paradas-numeradas";

/**
 * El mapa de las rutas del día y el panel «Choferes y rutas», para las DOS pantallas que los pintan: el Gestor de Rutas y
 * «Ruta de hoy» (D-467).
 *
 * El dueño, 2026-10-04, con la captura del bloque de arriba del Gestor: «este mapa lo quiero en el map view que ya esta y
 * que todos los puedan ver y se lo cambias de map a today's route». Todo esto estaba escrito dentro de `routes/page.tsx`.
 * Se sacó aquí —sin cambiar qué se pinta— para que la otra pantalla no sea una copia: las dos llaman a estas funciones con
 * la MISMA lectura (`lecturaDe`, `lista-unica`), así que un pin «D3» es el mismo «D3» en las dos.
 *
 * Lo que es solo del Gestor entra por `marcadas` (las órdenes marcadas ☑ para asignar, con su color): «Ruta de hoy» es de
 * solo lectura y no lo pasa.
 */

/** Lo que hace falta de una orden para pintarla. `Delivery` lo cumple, y la parada mínima de `rutas_del_dia` (160) también. */
export interface OrdenDelMapa extends OrdenAsignada {
  order_no: number;
  /** D-NEXT: dos entregas seguidas a la misma dirección son UNA parada (`gruposDeMismoLugar`). */
  delivery_address?: string | null;
  order_code?: string | null;
  order_suffix?: string | null;
  /** D-481 (a): el pin nombra la orden por su factura; sin ella, por su ID y «sin factura». */
  invoice_num?: string | null;
  stage: string;
  assigned_driver: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_date?: string | null;
  pod_delivered_at?: string | null;
  pickup_gps_at?: string | null;
}

/** Una ruta del panel: un chofer, o una ruta temporal («Ruta 1»), o una ruta huérfana que aún tiene órdenes. */
export interface CarrilDeRuta { id: string; key: string; driver: string; load: number; label: string; isBucket: boolean; store: string | null }

type T2 = (en: string, es: string) => string;
type Coords = { lat: number; lng: number };

/**
 * Las rutas del día: cada chofer, cada ruta temporal, y —red de seguridad— cualquier grupo con órdenes que no sea ni lo uno
 * ni lo otro (un chofer dado de baja, una ruta temporal retirada), para que su ruta siempre salga y se cuente. También quien
 * ya lo entregó todo (D-459).
 */
export function carrilesDelDia(
  choferes: readonly { id: string; full_name: string; store?: string | null }[], rutasTemporales: readonly string[],
  delDia: readonly { assigned_driver?: string | null }[], conLoHecho: Iterable<string>,
): CarrilDeRuta[] {
  const out: CarrilDeRuta[] = [];
  const seen = new Set<string>();
  const add = (l: CarrilDeRuta) => { if (!seen.has(l.key)) { seen.add(l.key); out.push(l); } };
  const esTemporal = (n: string) => rutasTemporales.includes(n);
  for (const dr of choferes) add({ id: dr.id, key: dr.full_name, driver: dr.full_name, load: 1, label: dr.full_name, isBucket: false, store: dr.store ?? null });
  for (const n of rutasTemporales) add({ id: `bucket:${n}`, key: n, driver: n, load: 1, label: n, isBucket: true, store: null });
  for (const d of delDia) {
    const key = d.assigned_driver || null;
    if (!key || seen.has(key)) continue;
    add({ id: `orphan:${key}`, key, driver: key, load: 1, label: key, isBucket: esTemporal(key), store: null });
  }
  for (const key of conLoHecho) {
    if (!seen.has(key)) add({ id: `orphan:${key}`, key, driver: key, load: 1, label: key, isBucket: esTemporal(key), store: null });
  }
  return out;
}

/** Las paradas pendientes de cada chofer, en su orden guardado: con puesto primero y por él; las sin puesto, detrás. */
export function rutasPorChofer<T extends { assigned_driver?: string | null; route_seq?: number | null; order_no: number }>(delDia: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const d of delDia) {
    const key = d.assigned_driver || null;
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(d);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.route_seq != null && b.route_seq != null) return a.route_seq - b.route_seq;
      if (a.route_seq != null) return -1;
      if (b.route_seq != null) return 1;
      return a.order_no - b.order_no;
    });
  }
  return map;
}

/**
 * La barra de carga del panel: la CARGA MÁXIMA de la lista contra el camión (D-443) — lo más cargado que va en algún punto
 * del día. Rojo solo si en alguna parada se pasa.
 */
export function cargaDelPanel(lectura: Pick<LecturaDeRuta, "filas">, capacidad: number): { pallets: number; cap: number; pct: number; over: boolean } {
  const pallets = cuentaDePallets(lectura.filas.map((f) => f.cambio), capacidad).totales.cargaMaxima;
  return { pallets, cap: capacidad, pct: capacidad > 0 ? Math.min(100, (pallets / capacidad) * 100) : 0, over: pallets > capacidad };
}

export interface EntradaDeLosPuntos<T extends OrdenDelMapa> {
  carriles: readonly CarrilDeRuta[];
  /** Lo pendiente de cada ruta, en su orden (`rutasPorChofer`). */
  porChofer: ReadonlyMap<string, T[]>;
  /** Todas las órdenes pendientes del día, con chofer o sin él. */
  delDia: readonly T[];
  /** Lo ya recogido o entregado de cada ruta (D-459). */
  hechas: ReadonlyMap<string, T[]>;
  /** El filtro de chofer (D-393): con uno elegido, el mapa enseña solo lo suyo. */
  pasaFiltro: (clave: string | null | undefined) => boolean;
  /** Hay un chofer elegido en el filtro: lo sin chofer no sale. */
  soloUnChofer: boolean;
  /** Hay choferes marcados en el panel. */
  enfocado: boolean;
  /** Esta ruta se atenúa (hay otras marcadas). */
  atenuada: (clave: string | null) => boolean;
  colorDe: (chofer: string | null) => string;
  colorSinChofer: string;
  /** La base de la ruta, ya con coordenadas, y su dirección para el rótulo. */
  baseDe: (clave: string) => { coords: [number, number]; direccion: string } | null;
  lecturaDe: (clave: string, paradas: T[]) => Pick<LecturaDeRuta, "etiquetaDe" | "filas">;
  coordsDeTienda: (nombre: string | null) => Coords | null;
  t: T2;
  /** Solo el Gestor: las órdenes marcadas ☑, cada una con su color. */
  marcadas?: { tiene: (id: string) => boolean; colorDe: (id: string) => string | undefined; cuantas: number };
  /** Lo que se añade al rótulo de una entrega («Ruta de hoy»: la ciudad, los pallets y la llegada). */
  detalleDe?: (d: T) => string;
}

/** The whole day is always on the map — a driver focus dims the rest rather than hiding it, so the full picture stays visible. */
export function puntosDeLasRutas<T extends OrdenDelMapa>(e: EntradaDeLosPuntos<T>): MapPoint[] {
  const { t, porChofer } = e;
  const tiene = (id: string) => e.marcadas?.tiene(id) ?? false;
  const selActive = (e.marcadas?.cuantas ?? 0) > 0;
  const colorMarcada = (id: string) => e.marcadas?.colorDe(id) ?? "#2456c9";
  const detalle = (d: T) => { const x = e.detalleDe?.(d) ?? ""; return x ? ` · ${x}` : ""; };
  // Cada parada va del color de su chofer: sin viajes (D-443) no hay un color por viaje (D-441) ni un viaje que esconder.
  const pts: MapPoint[] = [];
  // Pickup / base pins first, so a stop that sits right on the pickup still
  // draws on top of the "P" instead of being hidden behind it.
  for (const u of e.carriles) {
    if (!(porChofer.get(u.key) ?? []).length) continue;
    // Con un chofer elegido en el filtro (D-393), el mapa enseña solo lo suyo: su base, sus P, sus paradas y sus líneas.
    if (!e.pasaFiltro(u.key)) continue;
    const base = e.baseDe(u.key);
    if (!base) continue;
    pts.push({
      id: `__depot__${u.id}`,
      lat: base.coords[0],
      lng: base.coords[1],
      color: e.colorDe(u.driver),
      badge: "P",
      label: `${t("Pickup / base", "Recolección / base")} (${u.label}) — ${base.direccion}`,
      dimmed: e.atenuada(u.key) || selActive,
    });
  }
  // Las PARADAS de cada ruta (D-NEXT; antes, una burbuja por recogida con su «P1», D-334/D-443): una burbuja por parada,
  // con su número (1, 2, 3…) en el color del chofer, en el orden de la lista. Tres recogidas seguidas en la misma tienda
  // son UNA burbuja, «1», y al pasar el ratón dice qué se hace ahí («Parada 1 — recoger P1, P2, P3 · INV-…»). Entregas
  // seguidas a la misma dirección, igual: la burbuja la lleva la primera que se pinta; las demás no salen aparte.
  // La parada en una tienda de RTG SÍ lleva su burbuja (D-481 d la quitaba: sin número no decía nada que la casita no
  // dijera; con número, sin ella el mapa empezaría a contar en 2). La misma tienda más adelante es otra parada: otra
  // burbuja, abierta en abanico (D-367).
  /** Por orden de entrega con burbuja: sus números de parada y lo que dice cada una. */
  const paradaDe = new Map<string, { numeros: number[]; textos: string[] }>();
  /** Entregas que ya van dentro de la burbuja de otra orden de su misma parada. */
  const dentroDeOtra = new Set<string>();
  /** El número de parada de cada entrega (también de una marcada ☑, para su rótulo). */
  const numeroDe = new Map<string, number[]>();
  for (const [laneKey, list] of porChofer) {
    if (!list.some((d) => d.route_seq != null)) continue;
    if (!e.pasaFiltro(laneKey)) continue;
    const lectura = e.lecturaDe(laneKey, list);
    const porId = new Map(list.map((d) => [d.id, d]));
    const nombres = (ids: readonly string[]) => ids.flatMap((id) => { const d = porId.get(id); return d ? [nombreEnElMapa(d, t)] : []; });
    for (const p of paradasDeLaRuta(lectura.filas, list).paradas) {
      const texto = textoDeLaParada(p, nombres(p.ordenes), t);
      if (p.tipo === "P") {
        if (!p.lugar) continue;
        const tienda = e.coordsDeTienda(p.lugar);
        if (!tienda) continue;
        pts.push({
          id: `__parada__${laneKey}__${p.numero}`, lat: tienda.lat, lng: tienda.lng,
          color: e.colorDe(list[0].assigned_driver),
          badge: String(p.numero),
          label: `${texto} — ${list[0].assigned_driver} · ${p.lugar}`,
          dimmed: e.atenuada(laneKey) || selActive,
        });
        continue;
      }
      for (const id of p.ordenes) numeroDe.set(id, [...(numeroDe.get(id) ?? []), p.numero]);
      // La burbuja la lleva la primera orden de la parada que tenga punto y no esté marcada ☑ (una marcada se pinta aparte,
      // en su color de selección).
      const pintables = p.ordenes.filter((id) => { const d = porId.get(id); return !!d && d.route_seq != null && d.delivery_lat != null && d.delivery_lng != null && !tiene(id); });
      const [lleva, ...resto] = pintables;
      if (!lleva) continue;
      const ya = paradaDe.get(lleva) ?? { numeros: [], textos: [] };
      paradaDe.set(lleva, { numeros: [...ya.numeros, p.numero], textos: [...ya.textos, texto] });
      for (const id of resto) dentroDeOtra.add(id);
    }
  }
  for (const d of e.delDia) {
    if (d.delivery_lat == null || d.delivery_lng == null) continue;
    if (!d.assigned_driver) {
      const sel = tiene(d.id);
      // Lo sin chofer tampoco es de ese chofer: con el filtro puesto no sale, salvo que se haya marcado a propósito.
      if (!sel && e.soloUnChofer) continue;
      pts.push({
        id: d.id,
        lat: d.delivery_lat,
        lng: d.delivery_lng,
        color: sel ? colorMarcada(d.id) : e.colorSinChofer,
        badge: sel ? "D" : undefined,
        label: `${nombreEnElMapa(d, t)} — ${sel ? t("Delivery", "Entrega") : t("Unassigned", "Sin asignar")}${detalle(d)}`,
        dimmed: sel ? false : (e.enfocado || selActive),
      });
      continue;
    }
    const sel = tiene(d.id);
    const laneKey = d.assigned_driver;
    if (!sel && !e.pasaFiltro(laneKey)) continue;
    // Va dentro de la burbuja de otra orden de su misma parada (y no lleva una propia).
    if (!sel && dentroDeOtra.has(d.id) && !paradaDe.has(d.id)) continue;
    const list = porChofer.get(laneKey) ?? [];
    const idx = list.findIndex((x) => x.id === d.id);
    const parada = paradaDe.get(d.id);
    const badge = d.route_seq != null ? (numeroDe.get(d.id)?.join("·") ?? String(idx + 1)) : undefined;
    if (parada && !sel) {
      pts.push({
        id: d.id, lat: d.delivery_lat, lng: d.delivery_lng,
        color: e.colorDe(d.assigned_driver),
        badge,
        label: `${parada.textos.join(" / ")} — ${d.assigned_driver}${detalle(d)}`,
        dimmed: e.atenuada(laneKey) || selActive,
      });
      continue;
    }
    pts.push({
      id: d.id,
      lat: d.delivery_lat,
      lng: d.delivery_lng,
      // A selected assigned stop pops in its own selection color, un-dimmed,
      // marked "D" so it pairs with its "P" pickup pin.
      color: sel ? colorMarcada(d.id) : e.colorDe(d.assigned_driver),
      badge: sel ? "D" : badge,
      label: `${nombreEnElMapa(d, t)} — ${d.assigned_driver}${badge ? ` (${t("Stop", "Parada")} ${badge})` : ""}${detalle(d)}`,
      dimmed: sel ? false : (e.atenuada(laneKey) || selActive),
    });
  }
  // Lo ya hecho sigue en el mapa (D-459), como hecho: la entregada con ✓ y apagada; la recogida y aún en camino, con 🚚.
  // No es una parada que se pueda marcar ni mover: su id no es el de la orden, y pulsarla no hace nada.
  for (const [laneKey, lista] of e.hechas) {
    if (!e.pasaFiltro(laneKey)) continue;
    for (const d of lista) {
      if (d.delivery_lat == null || d.delivery_lng == null) continue;
      const entregada = d.stage === "delivered";
      const hora = entregada ? horaReal(d, "D") : null;
      pts.push({
        id: `__hecha__${d.id}`, lat: d.delivery_lat, lng: d.delivery_lng,
        color: e.colorDe(d.assigned_driver), badge: entregada ? "✓" : "🚚",
        label: `${nombreEnElMapa(d, t)} — ${d.assigned_driver} (${entregada ? t("Delivered", "Entregada") + (hora ? ` ${hora}` : "") : t("On its way", "En camino")})${detalle(d)}`,
        dimmed: entregada || e.atenuada(laneKey) || selActive,
      });
    }
  }
  return pts;
}

/**
 * Las marcas que caen en el MISMO punto se abren en abanico (D-367): donde se ven todas las rutas a la vez, 18 pares se
 * tapaban. La casita de la tienda no entra: no es de nadie y es el punto fijo.
 */
export function enAbanico(pts: MapPoint[]): MapPoint[] {
  const abanico = abanicoDeMarcas(pts);
  return abanico.size ? pts.map((p) => { const o = abanico.get(p.id); return o ? { ...p, offset: o } : p; }) : pts;
}

export interface EntradaDeLasLineas {
  /** El trazo medido de cada ruta (`useMedidaDeRutas`). */
  trazos: Readonly<Record<string, TripTrace[]>>;
  /** El trazo del plan PUBLICADO de cada ruta (D-352), si se pidió. */
  trazosDelPlan: Readonly<Record<string, [number, number][]>>;
  tieneParadas: (clave: string) => boolean;
  pasaFiltro: (clave: string) => boolean;
  /** ¿Se pinta la línea del plan publicado de esta ruta? (`pintaElTrazoDelPlan`, D-437). */
  sigueSuPlan: (clave: string) => boolean;
  colorDe: (chofer: string | null) => string;
  atenuada: (clave: string | null) => boolean;
}

/** Every measured driver's routes are always drawn; a focus just dims the others. */
export function lineasDeLasRutas(e: EntradaDeLasLineas): MapLine[] {
  // Con el filtro de chofer (D-393), solo las líneas de ese chofer. Y solo de quien tiene paradas (D-437): una ruta que
  // se quedó vacía no deja su línea en el mapa.
  const entries = Object.entries(e.trazos).filter(([driver]) => e.pasaFiltro(driver) && e.tieneParadas(driver));
  // Fan the routes out with a small perpendicular offset each, so where two
  // run along the same road they sit side by side rather than on top of
  // each other. Centered so the spread stays close to the actual road.
  const total = entries.reduce((n, [, trips]) => n + trips.length, 0);
  const spacing = 5;
  const center = (total - 1) / 2;
  const out: MapLine[] = [];
  let idx = 0;
  // Con plan publicado y su trazo ya pedido, la línea es la del plan (D-352) y no la medida de la tarjeta — mientras la
  // ruta SIGA siendo la publicada y le queden paradas (`sigueSuPlan`, D-437). Si no, la del plan no se pinta.
  // El trazo del plan es UNA línea para todo el día (y desde D-443 también la medida: una lista, un trazo).
  const conSuPlan = new Set(Object.entries(e.trazosDelPlan).filter(([driver, geom]) => geom.length > 1 && e.pasaFiltro(driver) && e.sigueSuPlan(driver)).map(([d]) => d));
  for (const driver of conSuPlan) {
    out.push({ id: `plan:${driver}`, color: e.colorDe(driverOf(driver)), positions: e.trazosDelPlan[driver], dimmed: e.atenuada(driver), offset: 0 });
  }
  for (const [driver, trips] of entries) {
    if (conSuPlan.has(driver)) continue;
    trips.forEach((trace, i) => {
      const color = e.colorDe(driverOf(driver));
      const dimmed = e.atenuada(driver);
      const offset = (idx - center) * spacing;
      // Delivery run: solid. Empty drive back to the pickup: dashed, and
      // pushed to its own parallel offset so that when it retraces the
      // outbound road the dashes sit BESIDE the solid line (and stay
      // visible) instead of landing on top of the same-color run.
      out.push({ id: `line:${driver}#${i}`, color, positions: trace.delivery, dimmed, offset });
      if (trace.ret.length > 1) out.push({ id: `ret:${driver}#${i}`, color, positions: trace.ret, dimmed, dashed: true, offset: offset + 7 });
      idx++;
    });
  }
  return out;
}

/** La ruta de la línea que se pulsó en el mapa (para resaltar a su chofer), o `null` si no es la línea de una ruta. */
export function rutaDeLaLinea(id: string): string | null {
  const m = id.match(/^(?:line|ret):(.+)#\d+$/);
  return m ? m[1] : null;
}

/** What the map frames: the focused drivers' stops + pickups when any are focused, otherwise the whole day. */
export function encuadreDeLasRutas(
  points: readonly MapPoint[], marcados: ReadonlySet<string>, porChofer: ReadonlyMap<string, { id: string }[]>, carriles: readonly CarrilDeRuta[],
): [number, number][] {
  if (marcados.size === 0) return points.map((p) => [p.lat, p.lng] as [number, number]);
  const ids = new Set<string>();
  for (const key of marcados) {
    for (const d of porChofer.get(key) ?? []) ids.add(d.id);
    const lane = carriles.find((l) => l.key === key);
    if (lane) ids.add(`__depot__${lane.id}`);
  }
  return points.filter((p) => ids.has(p.id)).map((p) => [p.lat, p.lng] as [number, number]);
}
