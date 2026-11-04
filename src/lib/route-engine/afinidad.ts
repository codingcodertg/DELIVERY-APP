/**
 * Afinidad aprendida (D-834): qué chofer suele llevar una orden como esta, aprendido de las rutas que el equipo publicó.
 *
 * El dueño, 2026-11-04: «siempre hay que volver a reorganizar todo porque nunca quedan como tienen que quedar; ya hemos
 * hecho varias rutas, quiero que el sistema estudie y aprenda de todas las que hemos hecho para que el botón de optimizar
 * y el autoassign funcionen como nosotros pensamos para armar las rutas».
 *
 * Tres señales, cada una una distribución entre los choferes, mezcladas:
 *  · la TIENDA donde se recoge (Julio sale de Pharr, Maximo de Brownsville…);
 *  · el SITIO de la entrega, por cercanía: las entregas pasadas a unas millas cuentan más cuanto más cerca (núcleo
 *    gaussiano), así aprende territorios sin ciudades escritas a mano;
 *  · la CUENTA (cliente) cuando ya se le ha llevado varias veces: el cliente que siempre lleva Ernesto.
 * Lo reciente pesa más (media vida en días). Solo se aprende de días ANTERIORES al que se planifica.
 *
 * Puro: sin base ni red. Lo usa la entrada del motor (`afinidad` en cada orden) y lo prueba la calibración.
 */

export interface Antecedente {
  chofer: string;
  /** YYYY-MM-DD del día de la ruta. */
  fecha: string;
  tienda?: string | null;
  cuenta?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface PedidoParaAfinidad { tienda?: string | null; cuenta?: string | null; lat?: number | null; lng?: number | null }

export interface OpcionesDeAfinidad {
  /** Radio del núcleo de cercanía, en millas. */
  sigmaMi: number;
  /** Lo de hace esta cantidad de días pesa la mitad. */
  mediaVidaDias: number;
  pesoTienda: number;
  pesoSitio: number;
  pesoCuenta: number;
  /** Peso mínimo acumulado de una cuenta para que cuente (≈ veces que se le llevó). */
  minCuenta: number;
  /** Cuánto se acerca cada señal al reparto parejo cuando hay poca historia (suavizado de Laplace, en «visitas»). */
  suavizado: number;
  /** Días hacia atrás que se miran. */
  ventanaDias: number;
}

/** Calibrado sobre 21 días reales (D-834): la tienda de recogida es la señal fuerte; la cercanía de la entrega, en ese
 *  conjunto, empeoraba el acierto (los choferes cruzan territorios para entregar). */
export const AFINIDAD_POR_DEFECTO: OpcionesDeAfinidad = {
  sigmaMi: 2.5, mediaVidaDias: 45, pesoTienda: 1, pesoSitio: 0, pesoCuenta: 0, minCuenta: 2, suavizado: 1, ventanaDias: 120,
};

/** Peso de la historia en el motor (D-834), en minutos equivalentes por orden que lleva un chofer que nunca la habría
 *  llevado. Calibrado sobre 21 días reales contra lo publicado. */
export const PESO_DE_HISTORIA_POR_DEFECTO = 240;

export const claveDeChofer = (s: string | null | undefined): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const clave = claveDeChofer;

const dias = (a: string, b: string): number => (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000;

function millas(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Aprende de la historia anterior a `hoy` y devuelve una función que, para una orden, da la afinidad de cada chofer
 * (0..1, suman 1 entre `choferes`). Un chofer sin historia recibe solo el suavizado: ni se le castiga del todo ni se le
 * prefiere.
 */
export function aprendeAfinidad(
  historia: readonly Antecedente[],
  choferes: readonly string[],
  hoy: string,
  opciones: Partial<OpcionesDeAfinidad> = {},
): (o: PedidoParaAfinidad) => Record<string, number> | null {
  const op = { ...AFINIDAD_POR_DEFECTO, ...opciones };
  const nombres = choferes.map(clave);
  const indice = new Map(nombres.map((n, i) => [n, i]));
  const k = nombres.length;
  const vistos = historia.flatMap((h) => {
    const i = indice.get(clave(h.chofer));
    const edad = dias(h.fecha, hoy);
    if (i === undefined || !(edad > 0) || edad > op.ventanaDias) return [];
    return [{ i, w: Math.pow(0.5, edad / op.mediaVidaDias), tienda: clave(h.tienda), cuenta: clave(h.cuenta), lat: h.lat ?? null, lng: h.lng ?? null }];
  });
  if (!vistos.length || k < 2) return () => null;

  const porTienda = new Map<string, number[]>();
  const porCuenta = new Map<string, number[]>();
  for (const v of vistos) {
    if (v.tienda) { const a = porTienda.get(v.tienda) ?? Array(k).fill(0); a[v.i] += v.w; porTienda.set(v.tienda, a); }
    if (v.cuenta) { const a = porCuenta.get(v.cuenta) ?? Array(k).fill(0); a[v.i] += v.w; porCuenta.set(v.cuenta, a); }
  }
  const conPunto = vistos.filter((v) => v.lat != null && v.lng != null);
  const normaliza = (c: number[], s: number): number[] => { const t = c.reduce((a, b) => a + b, 0) + s; return c.map((x) => (x + s / k) / t); };

  return (o) => {
    const señales: { p: number[]; w: number }[] = [];
    const t = porTienda.get(clave(o.tienda));
    if (t && op.pesoTienda > 0) señales.push({ p: normaliza(t, op.suavizado), w: op.pesoTienda });
    const c = porCuenta.get(clave(o.cuenta));
    if (c && op.pesoCuenta > 0 && c.reduce((a, b) => a + b, 0) >= op.minCuenta * 0.5) señales.push({ p: normaliza(c, op.suavizado), w: op.pesoCuenta });
    if (o.lat != null && o.lng != null && op.pesoSitio > 0 && conPunto.length) {
      const acc: number[] = Array(k).fill(0);
      const dos = 2 * op.sigmaMi * op.sigmaMi;
      for (const v of conPunto) { const d = millas(o.lat, o.lng, v.lat!, v.lng!); if (d < op.sigmaMi * 4) acc[v.i] += v.w * Math.exp(-(d * d) / dos); }
      const masa = acc.reduce((a, b) => a + b, 0);
      // Con poca masa cerca, la señal se acerca al reparto parejo sola (el suavizado pesa más que lo que hay).
      if (masa > 0.05) señales.push({ p: normaliza(acc, op.suavizado * 0.5), w: op.pesoSitio * Math.min(1, masa) });
    }
    if (!señales.length) return null;
    const wTot = señales.reduce((a, s) => a + s.w, 0);
    const out: Record<string, number> = {};
    nombres.forEach((n, i) => { out[n] = señales.reduce((a, s) => a + s.p[i] * s.w, 0) / wTot; });
    return out;
  };
}
