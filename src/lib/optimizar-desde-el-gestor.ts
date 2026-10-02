import { parseWindow } from "./dispatch";
import { cambiosDeLaLista, type ParadaDeLaLista } from "./lista-unica";
import type { EntradaDeOptimizar, PuntoEnElMapa, ResultadoDeOptimizar, TiemposDeLaRuta, VentanaDeEntrega } from "./optimiza-la-ruta";
import { claveDePunto } from "./route-times/claves";
import { serviceMin } from "./trip-timing";
import type { DriverSettings, NamedLocation, Profile } from "./types";

/**
 * Lo que el Gestor de Rutas pone alrededor de `optimizaLaLista` (D-NEXT): de dónde sale el camión, qué se le pasa al
 * optimizador, de dónde salen los tiempos por calles y qué dice el aviso al terminar. Todo puro —sin pantalla, sin base, sin
 * red: lo que llama a alguien llega inyectado—, para poder probarlo.
 *
 * El dueño, 2026-10-02: «sigamos trabajando en el alrgoritmo de optimizar ruta porque sigue muy mal ineficente».
 */

// ---------------------------------------------------------------------------------------------------------------------
// La base del chofer.

const igual = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** De las filas de `driver_settings` a «cuál es la tienda base de cada chofer», por NOMBRE (como se asigna en el Gestor). */
export function basesPorNombre(
  filas: readonly Pick<DriverSettings, "profile_id" | "base_store">[], usuarios: readonly Pick<Profile, "id" | "full_name">[],
): Map<string, string> {
  const nombreDe = new Map(usuarios.map((u) => [u.id, (u.full_name ?? "").trim()]));
  const m = new Map<string, string>();
  for (const f of filas) {
    const nombre = nombreDe.get(f.profile_id), base = (f.base_store ?? "").trim();
    if (nombre && base) m.set(nombre, base);
  }
  return m;
}

/**
 * La tienda BASE de un chofer: de dónde sale su camión y a dónde vuelve. La de Ajustes → Rutas (`driver_settings.base_store`,
 * la misma de la que lo saca «Armar rutas») y, si no la tiene, la tienda de su perfil (Usuarios). Sin ninguna —o si el nombre
 * no es una tienda de Ajustes—, `null`: la ruta se mide abierta y la tarjeta lo dice («⚠ sin base»).
 *
 * Hasta D-NEXT el Gestor usaba como base la dirección de recogida MÁS REPETIDA entre las órdenes de la ruta. Con una ruta que
 * carga sobre todo en otra tienda, el camión «salía» y «volvía» a un sitio que no es el suyo: medido sobre 40 rutas reales,
 * la base era otra en 11, y solo por eso el Optimizar de D-456 las dejaba con 251 minutos y 267 millas de más.
 */
export function tiendaBaseDelChofer(
  chofer: string, bases: ReadonlyMap<string, string>, usuarios: readonly Pick<Profile, "full_name" | "store">[], tiendas: readonly NamedLocation[],
): NamedLocation | null {
  const nombre = (chofer ?? "").trim();
  if (!nombre) return null;
  const deAjustes = bases.get(nombre);
  const dePerfil = usuarios.find((u) => (u.full_name ?? "").trim() === nombre)?.store;
  for (const candidata of [deAjustes, dePerfil]) {
    const t = (candidata ?? "").trim() ? tiendas.find((s) => igual(s.name, candidata)) : undefined;
    if (t) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que se le pasa al optimizador.

type OrdenDeLaRuta = {
  id: string; delivery_lat?: number | null; delivery_lng?: number | null; delivery_windows?: string | null;
  delivery_duration?: string | null; pickup_duration?: string | null; actual_pallets?: number | null; est_pallets?: number | null;
};

/**
 * La lista de un chofer, lista para optimizar: el punto de cada parada (la tienda de la recogida, el pin de la entrega), lo que
 * suma o resta en pallets, la VENTANA de cada entrega (y si es de las estrechas de Ajustes) y los minutos de carga y descarga
 * —los mismos que lee «Armar rutas» (`route-plan/entrada.ts`): `pickup_duration` y `delivery_duration`—.
 */
export function entradaDeOptimizar(args: {
  lista: readonly ParadaDeLaLista[];
  ordenes: readonly OrdenDeLaRuta[];
  base: PuntoEnElMapa | null;
  capacidad: number | null;
  /** Las coordenadas de una tienda de recogida, por su nombre (Ajustes). */
  coordsDeTienda: (nombre: string | null) => PuntoEnElMapa | null;
  /** ¿Esta ventana es de las que no se llega tarde nunca? (`esVentanaDura`, Ajustes). */
  esEstrecha: (ventana: string | null | undefined) => boolean;
  salidaMin: number;
}): EntradaDeOptimizar {
  const porId = new Map(args.ordenes.map((d) => [d.id, d]));
  const puntos: (PuntoEnElMapa | null)[] = [], ventanas: (VentanaDeEntrega | null)[] = [], servicios: number[] = [];
  for (const p of args.lista) {
    if (p.tipo === "P") {
      puntos.push(args.coordsDeTienda(p.tienda));
      ventanas.push(null);
      servicios.push(p.ordenes.reduce((s, id) => s + serviceMin(porId.get(id)?.pickup_duration), 0));
      continue;
    }
    const d = porId.get(p.orden);
    puntos.push(d?.delivery_lat != null && d.delivery_lng != null ? { lat: d.delivery_lat, lng: d.delivery_lng } : null);
    const w = parseWindow(d?.delivery_windows);
    ventanas.push(w ? { abre: w[0], cierra: w[1], estrecha: args.esEstrecha(d?.delivery_windows) } : null);
    servicios.push(serviceMin(d?.delivery_duration));
  }
  return {
    paradas: args.lista, puntos, cambios: cambiosDeLaLista(args.lista, args.ordenes), base: args.base, capacidad: args.capacidad,
    ventanas, servicios, salidaMin: args.salidaMin,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Los tiempos por calles: una petición por pulsación, y ninguna si esa forma de la ruta ya se pidió.

/** Cuántos puntos distintos acepta una petición. Una ruta real no pasa de 25; esto es para que nadie mande mil. */
export const MAX_PUNTOS_DE_UNA_RUTA = 60;

/** Los puntos DISTINTOS de una ruta —la base y cada parada con punto—, por su clave (lat,lng a 5 decimales). */
export function puntosDeLaEntrada(e: Pick<EntradaDeOptimizar, "base" | "puntos">): PuntoEnElMapa[] {
  const vistos = new Map<string, PuntoEnElMapa>();
  for (const p of [e.base, ...e.puntos]) if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && !vistos.has(claveDePunto(p))) vistos.set(claveDePunto(p), { lat: p.lat, lng: p.lng });
  return [...vistos.values()];
}

/** La FORMA de la ruta para pedir tiempos: sus puntos distintos, sin orden. Reordenar la ruta no cambia la forma. */
export const formaDeLosPuntos = (puntos: readonly PuntoEnElMapa[]): string => [...new Set(puntos.map(claveDePunto))].sort().join("|");

/** El cuerpo de `/api/route-matrix`, validado en el servidor: los puntos distintos por su clave, o `null` si no es una lista de puntos. */
export function puntosDeLaPeticion(cuerpo: unknown): Record<string, PuntoEnElMapa> | null {
  const lista = (cuerpo as { puntos?: unknown } | null)?.puntos;
  if (!Array.isArray(lista)) return null;
  const puntos: Record<string, PuntoEnElMapa> = {};
  for (const x of lista) {
    const lat = (x as { lat?: unknown } | null)?.lat, lng = (x as { lng?: unknown } | null)?.lng;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    puntos[claveDePunto({ lat, lng })] = { lat, lng };
  }
  return Object.keys(puntos).length > MAX_PUNTOS_DE_UNA_RUTA ? null : puntos;
}

export type QuienMidio = "cache" | "google" | "osrm" | "estimado";
export interface TiemposPedidos {
  tiempos: TiemposDeLaRuta;
  /** El peor proveedor que hubo que usar. «estimado»: no hay calles en esos números, es línea recta. */
  proveedor: QuienMidio;
  /** Peticiones que el servidor hizo a un proveedor de fuera por ESTA pulsación. 0 si salió de la caché (o de la memoria). */
  llamadas: number;
}

/**
 * Los tiempos por calles de una ruta. Con memoria por FORMA (`guardados`, mientras la pantalla esté abierta): pulsar otra vez
 * sobre la misma ruta —o sobre la misma ya reordenada— no vuelve a pedir nada. Lo estimado y lo que falla NO se guarda: la
 * siguiente pulsación lo vuelve a intentar. `null`: no se pudo (sin sesión, sin red, el servidor caído); el optimizador
 * estima en línea recta y el aviso lo dice.
 */
export async function tiemposDeLaRuta(
  puntos: readonly PuntoEnElMapa[], guardados: Map<string, TiemposPedidos>,
  pide: (puntos: PuntoEnElMapa[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>,
): Promise<TiemposPedidos | null> {
  const distintos = puntosDeLaEntrada({ base: null, puntos });
  if (distintos.length < 2) return { tiempos: {}, proveedor: "cache", llamadas: 0 };
  const forma = formaDeLosPuntos(distintos);
  const ya = guardados.get(forma);
  if (ya) return { ...ya, llamadas: 0 };
  try {
    const res = await pide(distintos);
    if (!res.ok) return null;
    const data = (await res.json()) as { tiempos?: unknown; proveedor?: unknown; llamadas?: unknown } | null;
    if (!data || typeof data.tiempos !== "object" || data.tiempos === null) return null;
    const proveedor: QuienMidio = data.proveedor === "google" || data.proveedor === "osrm" || data.proveedor === "estimado" ? data.proveedor : "cache";
    const pedidos: TiemposPedidos = { tiempos: data.tiempos as TiemposDeLaRuta, proveedor, llamadas: typeof data.llamadas === "number" ? data.llamadas : 0 };
    if (proveedor !== "estimado") guardados.set(forma, pedidos);
    return pedidos;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// El aviso al terminar: lo ganado, y lo que queda mal.

const MENOS = "−";
/** «−12.4» / «+3.1» / «0»: lo que cambió, con su signo. */
const conSigno = (n: number, decimales: number): string => {
  const r = Math.round(n * 10 ** decimales) / 10 ** decimales;
  return r === 0 ? "0" : `${r < 0 ? MENOS : "+"}${Math.abs(r).toFixed(decimales)}`;
};
const suma = (tarde: ResultadoDeOptimizar["antes"]["tarde"]) => tarde.reduce((s, t) => s + t.minutos, 0);

/**
 * Lo que dice el Gestor tras «🧭 Optimizar», en los dos idiomas. Primero LO GANADO —«−12.4 mi · −18 min»—, y si es el mejor
 * orden que existe o el mejor que se encontró; después lo que importa más que las millas: la capacidad, y si queda alguna
 * entrega fuera de su ventana (cuál y por cuánto). Y con qué se midió: si no hubo tiempos por calles, lo dice.
 */
export function avisoDeOptimizar(args: {
  ruta: string;
  r: Pick<ResultadoDeOptimizar, "cambio" | "antes" | "despues" | "sinPunto" | "exacta" | "medida">;
  /** `null`: no se pudieron pedir los tiempos. */
  tiempos: Pick<TiemposPedidos, "proveedor"> | null;
  hayBase: boolean;
  /** Cómo se nombra una orden en el aviso (su factura o su código). */
  nombreDe: (orden: string) => string;
  pallets: (n: number) => string;
  /** La base no guarda la posición de las recogidas (sin la 154). */
  sinRecogidas?: boolean;
}): { en: string; es: string } {
  const { r, ruta } = args;
  const porCalles = !!args.tiempos && args.tiempos.proveedor !== "estimado" && r.medida === "real";
  const cuales = r.despues.tarde.map((t) => `${args.nombreDe(t.orden)} ${t.minutos} min`).join(", ");
  const nA = r.antes.tarde.length, nD = r.despues.tarde.length;
  const noHayOtro = r.exacta ? { en: "no order avoids it", es: "ningún orden lo evita" } : { en: "no order found that avoids it", es: "no se encontró un orden que lo evite" };
  const tarde = nD > 0
    ? { en: ` ⚠ Still late for ${nD} delivery(ies): ${cuales} — ${noHayOtro.en}${r.cambio ? ` (before: ${nA}, ${suma(r.antes.tarde)} min)` : ""}.`,
        es: ` ⚠ Aún llega tarde a ${nD} entrega(s): ${cuales} — ${noHayOtro.es}${r.cambio ? ` (antes: ${nA}, ${suma(r.antes.tarde)} min)` : ""}.` }
    : nA > 0 ? { en: ` No delivery is late any more (${nA} were, ${suma(r.antes.tarde)} min).`, es: ` Ya ninguna entrega llega tarde (antes ${nA}, ${suma(r.antes.tarde)} min).` }
    : { en: "", es: "" };
  const exceso = r.despues.exceso > 0
    ? { en: ` ⚠ still over capacity by ${args.pallets(r.despues.exceso)} (was ${args.pallets(r.antes.exceso)}).`, es: ` ⚠ sigue pasándose de la capacidad en ${args.pallets(r.despues.exceso)} (antes ${args.pallets(r.antes.exceso)}).` }
    : r.antes.exceso > 0 ? { en: ` The truck no longer goes over capacity (it was over by ${args.pallets(r.antes.exceso)}).`, es: ` El camión ya no se pasa de su capacidad (se pasaba en ${args.pallets(r.antes.exceso)}).` }
    : { en: "", es: "" };
  const medida = porCalles ? { en: "", es: "" }
    : { en: " ⚠ Measured in a straight line (estimate): street times couldn't be fetched.", es: " ⚠ Medido en línea recta (estimado): no se pudieron pedir los tiempos por calles." };
  const notas = {
    en: (r.sinPunto ? ` ${r.sinPunto} stop(s) have no map pin and don't count.` : "") + (args.hayBase ? "" : " No base: measured as an open route."),
    es: (r.sinPunto ? ` ${r.sinPunto} parada(s) sin punto en el mapa no cuentan.` : "") + (args.hayBase ? "" : " Sin base: medida como ruta abierta."),
  };
  if (!r.cambio) {
    const ya = r.exacta ? { en: "already in the best possible order", es: "ya está en el mejor orden posible" } : { en: "already in the best order found", es: "ya está en el mejor orden que se encontró" };
    return {
      en: `🧭 ${ruta}: ${ya.en} (${r.antes.millas.toFixed(1)} mi · ${r.antes.minutos} min). Nothing changed.${tarde.en}${exceso.en}${medida.en}${notas.en}`,
      es: `🧭 ${ruta}: ${ya.es} (${r.antes.millas.toFixed(1)} mi · ${r.antes.minutos} min). No se cambió nada.${tarde.es}${exceso.es}${medida.es}${notas.es}`,
    };
  }
  const ganado = `${conSigno(r.despues.millas - r.antes.millas, 1)} mi · ${conSigno(r.despues.minutos - r.antes.minutos, 0)} min`;
  const cual = r.exacta ? { en: "the best possible order", es: "el mejor orden posible" } : { en: "the best order found", es: "el mejor orden que se encontró" };
  const sin154 = args.sinRecogidas
    ? { en: " Only the delivery order was saved: pickups need the database update (154).", es: " Solo se guardó el orden de las entregas: las recogidas necesitan la actualización de la base (154)." }
    : { en: "", es: "" };
  return {
    en: `🧭 ${ruta} optimized: ${ganado} (${cual.en}).${exceso.en}${tarde.en}${medida.en} Ctrl+Z undoes it.${notas.en}${sin154.en}`,
    es: `🧭 ${ruta} optimizada: ${ganado} (${cual.es}).${exceso.es}${tarde.es}${medida.es} Ctrl+Z lo deshace.${notas.es}${sin154.es}`,
  };
}
