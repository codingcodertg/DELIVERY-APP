import type { InformeDelDia, ParadaDelInforme } from "@/lib/reportes-choferes/dia";
import { MISMO_SITIO_M } from "@/lib/reportes-choferes/dia";
import { metros, millasDelRastro, minutosEnMovimiento, type FuenteDeRastro, type LatLng, type Rastro } from "@/lib/reportes-choferes/rastro";

// ============================================================
// APEGO A LA RUTA (D-910): la ruta que se PROGRAMÓ para un chofer un día, contra lo que de verdad hizo.
//
// El dueño, 2026-11-06, mirando el Recorrido: «quiero que se haga una comparación con la ruta que estaba programada y
// en porcentaje si se adhirió a la ruta y cuánto era las millas y tiempo total programado vs millas reales recorridas».
//
// NO es otro motor: todo sale del día ya calculado por «Reportes de choferes» (D-907, `informeDelDia`) y de su rastro.
// Así el Recorrido y el reporte dan los mismos números del mismo día. Lo que esto añade es la LECTURA:
//
//   · **Paradas del plan** = los SITIOS del plan vigente en su orden (`puestoPlan`: la recogida de varias órdenes en la
//     misma tienda a la misma hora es UNA parada; cada entrega es otra). Una parada está VISITADA si el rastro vio al
//     vehículo quedarse ahí (150 m, 2 min, `visitas.ts`) o, sin rastro, si el propio chofer tocó «llegué»/«entregada».
//   · **Apego al orden** (el porcentaje de cabecera) = paradas del plan hechas EN SU ORDEN ÷ paradas del plan. «En su
//     orden» lo decide `comparaOrden` (D-907): la subsecuencia más larga de lo hecho que respeta el plan; lo que sobra
//     está «fuera de orden». Una parada que no se visitó tampoco cuenta como en orden: saltarse la mitad de la ruta no
//     es seguirla al 100 %.
//   · **Apego al camino** (secundario) = parte de las millas del rastro que caen a 150 m o menos del CAMINO planeado.
//     El hub NO guarda la geometría de las calles de un plan, así que el camino planeado son RECTAS entre paradas: el
//     número sirve para comparar días entre sí, no como medida absoluta, y la pantalla lo dice.
//   · **Millas y tiempo planeados**: los tramos del plan (caché de tiempos del planificador; donde falta, recta × 1,3 a
//     30 mph y se marca «estimado») y los minutos de servicio de cada parada. **Reales**: el rastro entero del día
//     (millas con el temblor del GPS descontado; manejando = tramos a más de ~2 mph; total = del primer punto al último,
//     o hasta ahora si el día sigue en vivo).
//
// Puro: sin base, sin red, sin React. Lo importan la ruta del servidor y la pantalla.
// ============================================================

/** A cuántos metros del camino planeado se considera que el camión «iba por la ruta». */
export const CORREDOR_M = 150;
/** Si el último punto del rastro de HOY tiene menos de esto, el día sigue: el tiempo real llega hasta ahora. */
export const EN_VIVO_MS = 20 * 60_000;

export interface ParadaDelPlan {
  /** Puesto en el plan vigente (1, 2, 3…). */
  puesto: number;
  lat: number; lng: number;
  lugar: string;
  /** Códigos de las órdenes que se atienden en esta parada (FW186…), con su tipo: `P` recogida, `D` entrega.
   * D-NEXT: con su `id` y su `factura` (número de factura), para que el Recorrido las nombre por la factura y abra la ficha. */
  ordenes: { codigo: string; tipo: "P" | "D"; id?: string; factura?: string | null }[];
  /** Minuto del día local de la hora estimada del plan. */
  eta: number | null;
  /** Milisegundos de la llegada real, si se vio. */
  llegada: number | null;
  visitada: boolean;
  /** Visitada y en su puesto respecto a las demás. */
  enOrden: boolean;
  /** Alguna de sus órdenes ya se cerró en la app (aunque el rastro no la haya visto). */
  hecha: boolean;
  esTienda: boolean;
}

export interface ApegoDelDia {
  /** `false`: ese chofer no tenía ruta programada ese día. Todo lo demás va vacío o en `null`. */
  hayPlan: boolean;
  rastro: { fuente: FuenteDeRastro | null; camion: string | null; escaso: boolean; puntos: number };
  paradas: ParadaDelPlan[];
  orden: {
    planeadas: number; visitadas: number; enOrden: number;
    /** El porcentaje de cabecera: `enOrden / planeadas`. `null` sin plan. */
    pct: number | null;
    /** Códigos (con tipo) de las paradas hechas fuera de su puesto, y de las que no se visitaron. */
    fueraDeOrden: string[]; noVisitadas: string[];
  };
  camino: {
    /** Parte de las millas del rastro a ≤ 150 m del camino planeado (rectas entre paradas). `null` sin rastro o sin plan. */
    pct: number | null;
    millasDentro: number; millas: number;
    /** Siempre `true` hoy: el camino planeado son rectas, no calles. */
    rectas: true; corredorM: number;
  };
  plan: {
    millas: number | null; minutosManejo: number | null; minutosServicio: number; minutosTotal: number | null;
    /** Algún tramo salió de la recta × 1,3 porque la caché no lo tenía. */
    estimado: boolean; tramos: number; tramosEstimados: number;
  };
  real: {
    millas: number | null; minutosManejo: number | null; minutosTotal: number | null;
    desde: number | null; hasta: number | null;
    /** El día sigue: `hasta` es «ahora». */
    enVivo: boolean;
  };
  /** Real − plan. Positivo: más que lo planeado. `pct` sobre lo planeado. */
  diferencia: { millas: number | null; millasPct: number | null; minutos: number | null; minutosPct: number | null };
  /** El camino planeado para el mapa: las paradas en su orden, sin repetir sitio. */
  lineaDelPlan: [number, number][];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 100) : null);
const etiqueta = (p: Pick<ParadaDelInforme, "tipo" | "codigo">) => `${p.tipo} ${p.codigo}`;

/** Distancia (m) de `p` al segmento `a`–`b` en un plano local: de sobra para tramos de pocas millas. */
export function metrosAlSegmento(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180), ky = 110_540;
  const bx = (b.lng - a.lng) * kx, by = (b.lat - a.lat) * ky, px = (p.lng - a.lng) * kx, py = (p.lat - a.lat) * ky;
  const largo2 = bx * bx + by * by;
  const u = largo2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / largo2));
  return Math.hypot(px - u * bx, py - u * by);
}

/** Distancia (m) de un punto a una línea quebrada. `Infinity` si la línea no tiene puntos. */
export function metrosALaLinea(p: LatLng, linea: readonly LatLng[]): number {
  if (!linea.length) return Infinity;
  if (linea.length === 1) return metros(p, linea[0]);
  let min = Infinity;
  for (let i = 1; i < linea.length; i++) min = Math.min(min, metrosAlSegmento(p, linea[i - 1], linea[i]));
  return min;
}

/**
 * Qué parte de lo manejado fue por el camino planeado: las millas de los tramos del rastro cuyos dos extremos caen a
 * `corredorM` o menos de la línea, sobre las millas de todos los tramos. El temblor del GPS parado no suma (30 m).
 */
export function apegoAlCamino(rastro: Rastro | null, linea: readonly LatLng[], corredorM = CORREDOR_M): ApegoDelDia["camino"] {
  const vacio: ApegoDelDia["camino"] = { pct: null, millasDentro: 0, millas: 0, rectas: true, corredorM };
  if (!rastro || rastro.puntos.length < 2 || linea.length < 2) return vacio;
  const ps = rastro.puntos;
  let total = 0, dentro = 0, ancla = ps[0], anclaDentro = metrosALaLinea(ancla, linea) <= corredorM;
  for (let i = 1; i < ps.length; i++) {
    const p = ps[i], d = metros(ancla, p);
    if (d < 30) continue;
    const pDentro = metrosALaLinea(p, linea) <= corredorM;
    total += d;
    if (pDentro && anclaDentro) dentro += d;
    ancla = p; anclaDentro = pDentro;
  }
  const millas = r1(total / 1609.344), millasDentro = r1(dentro / 1609.344);
  return { pct: total > 0 ? Math.round((dentro / total) * 100) : null, millasDentro, millas, rectas: true, corredorM };
}

/** Las paradas del plan (los sitios en su orden), con lo que se vio de cada una. */
export function paradasDelPlan(paradas: readonly ParadaDelInforme[]): ParadaDelPlan[] {
  const por = new Map<number, ParadaDelInforme[]>();
  for (const p of paradas) if (p.puestoPlan != null) por.set(p.puestoPlan, [...(por.get(p.puestoPlan) ?? []), p]);
  return [...por.entries()].sort((a, b) => a[0] - b[0]).map(([puesto, ps]) => {
    const conSitio = ps.find((p) => p.lat != null && p.lng != null) ?? ps[0];
    const llegadas = ps.map((p) => p.llegada).filter((t): t is number => t != null);
    const visitada = llegadas.length > 0;
    return {
      puesto, lat: conSitio.lat ?? NaN, lng: conSitio.lng ?? NaN,
      lugar: conSitio.tienda ?? conSitio.lugar,
      ordenes: ps.map((p) => ({ codigo: p.codigo, tipo: p.tipo, id: p.ordenId, factura: p.factura ?? null })),
      eta: ps[0].eta, llegada: visitada ? Math.min(...llegadas) : null, visitada,
      enOrden: visitada && !ps.some((p) => p.llegada != null && p.fueraDeOrden),
      hecha: ps.some((p) => p.hecha), esTienda: ps.some((p) => p.esTienda),
    };
  });
}

/** La línea del plan para el mapa: las paradas con sitio, en orden, sin repetir el mismo sitio dos veces seguidas. */
export function lineaDelPlan(paradas: readonly ParadaDelPlan[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of paradas) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const prev = out[out.length - 1];
    if (!prev || metros({ lat: prev[0], lng: prev[1] }, p) > MISMO_SITIO_M) out.push([p.lat, p.lng]);
  }
  return out;
}

export interface OpcionesDeApego {
  /** Ahora (ms). Solo se usa para saber si el día sigue en vivo. */
  ahora?: number;
  /** ¿Es la fecha del informe el día de hoy (en la zona del negocio)? Sin esto, nunca se da por en vivo. */
  esHoy?: boolean;
}

export function apegoDelDia(informe: InformeDelDia, rastro: Rastro | null, opciones: OpcionesDeApego = {}): ApegoDelDia {
  const paradas = paradasDelPlan(informe.paradas);
  const hayPlan = paradas.length > 0;
  const r = rastro && rastro.puntos.length >= 2 ? rastro : null;

  const visitadas = paradas.filter((p) => p.visitada), enOrden = paradas.filter((p) => p.enOrden);
  const fueraDeOrden = informe.paradas.filter((p) => p.puestoPlan != null && p.llegada != null && p.fueraDeOrden).map(etiqueta);
  const noVisitadas = paradas.filter((p) => !p.visitada).flatMap((p) => p.ordenes.map((o) => `${o.tipo} ${o.codigo}`));

  const linea = lineaDelPlan(paradas);
  const camino = apegoAlCamino(hayPlan ? r : null, linea.map(([lat, lng]) => ({ lat, lng })));

  const minutosServicio = hayPlan ? informe.paradas.filter((p) => p.puestoPlan != null).reduce((s, p) => s + (p.minPlaneados || 0), 0) : 0;
  const plan: ApegoDelDia["plan"] = {
    millas: hayPlan ? informe.plan.millas : null, minutosManejo: hayPlan ? informe.plan.minutos : null, minutosServicio,
    minutosTotal: hayPlan && informe.plan.minutos != null ? informe.plan.minutos + minutosServicio : null,
    estimado: informe.plan.tramosEstimados > 0, tramos: informe.plan.tramos, tramosEstimados: informe.plan.tramosEstimados,
  };

  const ahora = opciones.ahora ?? Date.now();
  const desde = r ? r.puntos[0].t : null, ultimo = r ? r.puntos[r.puntos.length - 1].t : null;
  const enVivo = !!opciones.esHoy && ultimo != null && ahora - ultimo <= EN_VIVO_MS && ahora > ultimo;
  const hasta = enVivo ? ahora : ultimo;
  const real: ApegoDelDia["real"] = {
    millas: r ? millasDelRastro(r) : null, minutosManejo: r ? minutosEnMovimiento(r) : null,
    minutosTotal: desde != null && hasta != null ? Math.round((hasta - desde) / 60_000) : null,
    desde, hasta, enVivo,
  };

  const dMillas = plan.millas != null && real.millas != null ? r1(real.millas - plan.millas) : null;
  const dMin = plan.minutosTotal != null && real.minutosTotal != null ? real.minutosTotal - plan.minutosTotal : null;
  return {
    hayPlan,
    rastro: { fuente: informe.rastro.fuente, camion: informe.rastro.camion, escaso: informe.rastro.escaso, puntos: informe.rastro.puntos },
    paradas,
    orden: { planeadas: paradas.length, visitadas: visitadas.length, enOrden: enOrden.length, pct: hayPlan ? pct(enOrden.length, paradas.length) : null, fueraDeOrden, noVisitadas },
    camino, plan, real,
    diferencia: {
      millas: dMillas, millasPct: dMillas != null && plan.millas ? Math.round((dMillas / plan.millas) * 100) : null,
      minutos: dMin, minutosPct: dMin != null && plan.minutosTotal ? Math.round((dMin / plan.minutosTotal) * 100) : null,
    },
    lineaDelPlan: linea,
  };
}

/** Lo que viaja al navegador por cada chofer (`/api/route-adherence`). */
export type ApegoDelChofer = ApegoDelDia & { driverId: string; chofer: string; fecha: string };

/** Lo que contestó la ruta, validado por encima: lo que no tenga chofer y plan en forma, fuera. */
export function apegosDeLaRespuesta(cuerpo: unknown): ApegoDelChofer[] {
  const xs = (cuerpo as { drivers?: unknown } | null)?.drivers;
  if (!Array.isArray(xs)) return [];
  return (xs as (Partial<ApegoDelChofer> | null)[]).filter((a): a is ApegoDelChofer =>
    !!a && typeof a.driverId === "string" && typeof a.hayPlan === "boolean" && Array.isArray(a.paradas) && !!a.orden && !!a.plan && !!a.real && Array.isArray(a.lineaDelPlan));
}
