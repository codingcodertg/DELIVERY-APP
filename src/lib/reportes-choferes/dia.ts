import { parseWindow } from "@/lib/dispatch";
import { minutoEnZona } from "@/lib/route-plan/llegadas";
import { estancias, metros, millasDelRastro, minutosEnMovimiento, huecosDelRastro, posicionEn, tiempoEnHuecos, type FuenteDeRastro, type LatLng, type Rastro } from "./rastro";
import { durante, permanenciaS, RADIO_DE_PARADA_M, vale, visitasA, type Visita } from "./visitas";
import { comparaOrden } from "./orden";

/**
 * El día de UN chofer, parada a parada (D-NEXT, «Reportes de choferes»): lo planeado contra lo hecho.
 *
 * De dónde sale cada cosa (y la pantalla lo dice en cada número):
 *   · **Paradas del día**: las órdenes del chofer con esa fecha de entrega. Cada orden da una ENTREGA y, si se cargó ese
 *     día (o aún no se cargó), una RECOGIDA.
 *   · **Plan**: `delivery_eta_plans` — la primera hora que el Gestor midió ese día (`first_eta`) y la del plan vigente
 *     (`eta`). El ORDEN planeado es el de esas horas del plan vigente.
 *   · **Real**: la visita del rastro (camión o teléfono, `visitas.ts`); si no hay, el toque del PROPIO chofer («llegué», y si
 *     no, el de cerrar: «recogida»/«entregada»). Un toque de otra persona no mide dónde estuvo el camión: es «sin dato».
 *     Cada hora lleva su fuente.
 *
 * Qué visita es la de cada parada, cuando el camión pasó varias veces por el sitio (la tienda): la ENTREGA, la última
 * visita que empezó antes del toque del chofer (el toque suele llegar tarde, nunca antes de estar); sin toque, la primera
 * después de cargar. La RECOGIDA, la última visita anterior a entregar esa orden — porque «recogida» se toca muchas veces
 * ya en la puerta del cliente, y esa hora no sirve para elegir.
 *
 * Puro: sin base, sin red, sin reloj, sin React.
 */

/** Un toque del chofer en la app. `porElChofer`: lo pulsó él (y no alguien desde un escritorio). */
export interface Toque { t: number; porElChofer: boolean; lat?: number | null; lng?: number | null }

export interface PlanDeParada {
  /** Minutos del día local. `primera`: la primera que se apuntó ese día; `eta`: la del plan vigente. */
  eta: number; primera: number | null;
  /** Cuándo se apuntó cada una (ms): una «estimación» escrita después de hacer la parada no estima nada. */
  apuntadaEn: number | null; rehechaEn: number | null;
}

export interface OrdenDelDia {
  id: string; codigo: string; tipo: string | null; tienda: string | null; cliente: string | null; etapa: string;
  recogida: (LatLng & { nombre: string }) | null;
  entrega: (LatLng & { nombre: string }) | null;
  /** ¿Entra la recogida en este día? (No, si se cargó otro día.) */
  conRecogida: boolean;
  ventana: string | null;
  /** Minutos de servicio que el planificador supone en cada parada. */
  minRecogida: number; minEntrega: number;
  ordenEnLista: number | null;
  toques: { llegoARecoger?: Toque | null; recogio?: Toque | null; llegoAEntregar?: Toque | null; entrego?: Toque | null };
  plan: { P?: PlanDeParada | null; D?: PlanDeParada | null };
}

export interface TramoPlaneado { millas: number; minutos: number; estimado: boolean }

export interface EntradaDelDia {
  fecha: string; zona: string; choferId: string | null; chofer: string;
  ordenes: readonly OrdenDelDia[];
  rastro: Rastro | null;
  /** El nombre del camión, si el rastro es el suyo. */
  camion?: string | null;
  tiendas: readonly { name: string; lat: number; lng: number }[];
  /** Pausas que el chofer declaró (gasolina, comida): no cuentan como parado fuera de ruta. */
  pausas?: readonly { desde: number; hasta: number }[];
  /** Millas y minutos de manejo entre dos sitios, según la caché de tiempos del planificador. */
  tramo: (a: LatLng, b: LatLng) => TramoPlaneado;
  /** El instante (ms) de un minuto del día local de `fecha`. */
  instante: (minutoDelDia: number) => number;
}

export type FuenteDeHora = FuenteDeRastro | "toque_llegada" | "toque_cierre";
export type MotivoSinHora = "toco_lejos" | "sin_punto" | "sin_rastro" | "no_paro_ahi" | "la_marco_otra_persona" | "pendiente";
export type ClaseDeVisita = "recogida_tienda" | "recogida_otro" | "entrega_cliente" | "entrega_tienda";

export interface ParadaDelInforme {
  clave: string; ordenId: string; codigo: string; tipo: "P" | "D";
  lugar: string; cliente: string | null; tienda: string | null; esTienda: boolean; lat: number | null; lng: number | null;
  hecha: boolean;
  /** Puesto en el plan vigente y en lo hecho (1, 2, 3…; las de una misma visita comparten puesto). */
  puestoPlan: number | null; puestoReal: number | null;
  /** Minutos del día local. */
  primeraEta: number | null; eta: number | null;
  /** La estimación se apuntó DESPUÉS de hacer la parada: no entra en ninguna cuenta. */
  primeraPosterior: boolean; etaPosterior: boolean;
  /** Milisegundos. Con `toque_cierre`, llegada y salida son la misma hora: la de cerrar. */
  llegada: number | null; salida: number | null; fuente: FuenteDeHora | null; motivo: MotivoSinHora | null;
  /** Índice en `visitas` de la visita del rastro que la sostiene. */
  visita: number | null;
  /** Real − estimada, en minutos (positivo = más tarde). */
  difPrimera: number | null; difPlan: number | null;
  fueraDeOrden: boolean;
  /** Solo entregas: minutos que la llegada pasa del FIN de la ventana (≤ 0 = a tiempo). */
  sobreLaVentana: number | null;
  /** El toque de cerrar, si lo pulsó el chofer: dónde estaba al tocar. */
  toque: { t: number; enLaParada: boolean | null; metros: number | null; posicion: "toque" | FuenteDeRastro | "visita" | null } | null;
  toqueDeOtraPersona: boolean;
  minPlaneados: number;
}

export interface VisitaDelInforme {
  lugar: string; clase: ClaseDeVisita; tienda: string | null; cliente: string | null; lat: number; lng: number;
  llegada: number; salida: number; minutos: number; fuente: FuenteDeRastro;
  paradas: string[]; ordenes: number; minPlaneados: number;
  /** No se vio llegar o no se vio irse: no entra en las medianas de tiempo por parada. */
  truncada: boolean;
}

export interface InformeDelDia {
  fecha: string; choferId: string | null; chofer: string;
  rastro: { fuente: FuenteDeRastro | null; camion: string | null; puntos: number; desde: number | null; hasta: number | null; huecos: number;
    /** Rastro ESCASO (menos de un punto cada 2 minutos de media, o con huecos que suman más de un tercio del día): sirve
     *  para ver si paró en un sitio, pero no para dar millas, tiempo manejando, salida ni ratos parado. */
    escaso: boolean };
  paradas: ParadaDelInforme[]; visitas: VisitaDelInforme[];
  orden: { comparadas: number; fueraDeOrden: number };
  plan: { millas: number | null; minutos: number | null; tramos: number; tramosEstimados: number; paradas: number };
  real: {
    /** Del rastro, entre la primera y la última llegada a una parada (lo comparable con el plan). */
    millasEntreParadas: number | null; minutosManejando: number | null;
    millasDelDia: number | null;
    /** Cuándo salió del sitio donde empezó el día (solo si empezó en una tienda). */
    primeraSalida: number | null;
    primeraLlegada: number | null; ultimaSalida: number | null;
  };
  /** Parado 5 min o más lejos de toda parada del día y de toda tienda, entre la primera salida y la última llegada. */
  parado: { minutos: number | null; veces: number; ratos: { desde: number; hasta: number; lat: number; lng: number }[] };
  toques: { propios: number; conPosicion: number; enLaParada: number; deOtraPersona: number };
}

/** Dos paradas a menos de esto son el mismo sitio (la misma tienda, el mismo cliente). */
export const MISMO_SITIO_M = 75;
/** Un sitio a menos de esto de una tienda de Ajustes ES esa tienda. */
export const CERCA_DE_TIENDA_M = 200;
/** Un toque a menos de esto de la parada se hizo «en la parada» (el GPS del teléfono dentro de un edificio baila). */
export const RADIO_DEL_TOQUE_M = 300;
/** Si el vehículo no paró a 150 m de la parada, se mira a 300 m: la dirección de un cliente a veces cae a una cuadra. */
export const RADIO_AMPLIO_M = 300;
/** Salir del sitio donde empezó el día: alejarse esto. */
const SALIO_M = 300;

interface Sitio extends LatLng { tienda: string | null; visitas: Visita[] }
interface Borrador extends ParadaDelInforme { sitio: number | null; orden: OrdenDelDia; _visita: Visita | null }

const ETAPAS_CON_RECOGIDA = new Set(["picked_up", "en_route", "out_for_delivery", "arrived_delivery", "delivered"]);

export function informeDelDia(e: EntradaDelDia): InformeDelDia {
  const rastro = e.rastro && e.rastro.puntos.length ? e.rastro : null;
  const propio = (t: Toque | null | undefined): number | null => (t && t.porElChofer && Number.isFinite(t.t) ? t.t : null);
  const tiendaCerca = (p: LatLng): string | null => {
    let mejor: { n: string; d: number } | null = null;
    for (const s of e.tiendas) {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
      const d = metros(p, s);
      if (d <= CERCA_DE_TIENDA_M && (!mejor || d < mejor.d)) mejor = { n: s.name, d };
    }
    return mejor?.n ?? null;
  };

  // ---- 1. Las paradas y sus sitios ----
  const sitios: Sitio[] = [];
  const sitioDe = (p: LatLng | null): number | null => {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    const i = sitios.findIndex((s) => metros(s, p) <= MISMO_SITIO_M);
    if (i >= 0) return i;
    sitios.push({ lat: p.lat, lng: p.lng, tienda: tiendaCerca(p), visitas: [] });
    return sitios.length - 1;
  };
  const paradas: Borrador[] = [];
  for (const o of e.ordenes) {
    for (const tipo of ["P", "D"] as const) {
      if (tipo === "P" && !o.conRecogida) continue;
      const punto = tipo === "P" ? o.recogida : o.entrega;
      const sitio = sitioDe(punto);
      const plan = o.plan[tipo] ?? null;
      const cierre = tipo === "P" ? o.toques.recogio : o.toques.entrego;
      const hecha = tipo === "P" ? !!cierre || ETAPAS_CON_RECOGIDA.has(o.etapa) : !!cierre || o.etapa === "delivered";
      paradas.push({
        clave: `${tipo}:${o.id}`, ordenId: o.id, codigo: o.codigo, tipo, orden: o, sitio, _visita: null,
        lugar: punto?.nombre || (tipo === "P" ? o.tienda : o.cliente) || "—", cliente: o.cliente, tienda: sitio != null ? sitios[sitio].tienda : null,
        esTienda: sitio != null && !!sitios[sitio].tienda, lat: punto?.lat ?? null, lng: punto?.lng ?? null, hecha,
        puestoPlan: null, puestoReal: null, primeraEta: plan?.primera ?? null, eta: plan?.eta ?? null, primeraPosterior: false, etaPosterior: false,
        llegada: null, salida: null, fuente: null, motivo: null, visita: null, difPrimera: null, difPlan: null, fueraDeOrden: false, sobreLaVentana: null,
        toque: null, toqueDeOtraPersona: !!cierre && !cierre.porElChofer, minPlaneados: tipo === "P" ? o.minRecogida : o.minEntrega,
      });
    }
  }

  // ---- 2. Las visitas del rastro a cada sitio ----
  if (rastro) {
    const toquesEn = new Map<number, number[]>();
    for (const p of paradas) {
      if (p.sitio == null) continue;
      const ts = p.tipo === "P" ? [propio(p.orden.toques.llegoARecoger), propio(p.orden.toques.recogio)] : [propio(p.orden.toques.llegoAEntregar), propio(p.orden.toques.entrego)];
      toquesEn.set(p.sitio, [...(toquesEn.get(p.sitio) ?? []), ...ts.filter((t): t is number => t != null)]);
    }
    sitios.forEach((s, i) => {
      s.visitas = visitasA(rastro, s).filter((v) => vale(v, toquesEn.get(i) ?? []));
      // Nada a 150 m: se mira a 300 m, y ahí solo vale quedarse (un toque no confirma una pasada tan lejos).
      if (!s.visitas.length && !s.tienda) s.visitas = visitasA(rastro, s, { radioM: RADIO_AMPLIO_M }).filter((v) => vale(v));
    });
  }

  // ---- 3. Qué visita es la de cada parada: primero las recogidas, luego las entregas (que no pueden ir antes) ----
  const recogidaDe = new Map<string, Visita>();
  for (const tipo of ["P", "D"] as const) {
    for (const p of paradas) {
      if (p.tipo !== tipo || p.sitio == null) continue;
      const vs = sitios[p.sitio].visitas;
      if (!vs.length) continue;
      const o = p.orden;
      if (tipo === "P") {
        const tope = Math.min(...[propio(o.toques.recogio), propio(o.toques.llegoAEntregar), propio(o.toques.entrego)].filter((t): t is number => t != null).map((t) => t + 5 * 60_000), Infinity);
        const antes = vs.filter((v) => v.llegada <= tope);
        p._visita = Number.isFinite(tope) && antes.length ? antes[antes.length - 1] : vs[0];
        recogidaDe.set(o.id, p._visita);
      } else {
        const suelo = recogidaDe.get(o.id)?.llegada ?? -Infinity;
        const posibles = vs.filter((v) => v.salida >= suelo);
        if (!posibles.length) continue;
        const ref = propio(o.toques.llegoAEntregar) ?? propio(o.toques.entrego);
        if (ref == null) { p._visita = posibles[0]; continue; }
        const antes = posibles.filter((v) => v.llegada <= ref + 5 * 60_000);
        p._visita = antes.length ? antes[antes.length - 1] : posibles[0];
      }
    }
  }

  // ---- 4. La hora real de cada parada y su fuente ----
  for (const p of paradas) {
    const o = p.orden;
    const llego = propio(p.tipo === "P" ? o.toques.llegoARecoger : o.toques.llegoAEntregar);
    const cerro = propio(p.tipo === "P" ? o.toques.recogio : o.toques.entrego);
    // Un toque del que se SABE que se hizo lejos de la parada no dice cuándo se llegó a ella.
    const lejos = (t: number, propia?: Toque | null): boolean => {
      if (p.lat == null || p.lng == null) return false;
      const pos = propia && propia.lat != null && propia.lng != null ? { lat: propia.lat, lng: propia.lng } : rastro ? posicionEn(rastro, t) : null;
      return !!pos && metros(pos, { lat: p.lat, lng: p.lng }) > RADIO_DEL_TOQUE_M;
    };
    if (p._visita && rastro) { p.llegada = p._visita.llegada; p.salida = p._visita.salida; p.fuente = rastro.fuente; }
    else if ((llego != null && lejos(llego)) || (llego == null && cerro != null && lejos(cerro, p.tipo === "P" ? o.toques.recogio : o.toques.entrego))) p.motivo = "toco_lejos";
    else if (llego != null) { p.llegada = llego; p.salida = cerro != null && cerro >= llego ? cerro : null; p.fuente = "toque_llegada"; }
    else if (cerro != null) { p.llegada = cerro; p.salida = cerro; p.fuente = "toque_cierre"; }
    else p.motivo = p.toqueDeOtraPersona ? "la_marco_otra_persona" : !p.hecha ? "pendiente" : p.sitio == null ? "sin_punto" : !rastro ? "sin_rastro" : "no_paro_ahi";

    // El toque de cerrar: ¿se hizo en la parada?
    if (cerro != null) {
      const cierre = (p.tipo === "P" ? o.toques.recogio : o.toques.entrego)!;
      let pos: LatLng | null = null, de: NonNullable<ParadaDelInforme["toque"]>["posicion"] = null;
      if (cierre.lat != null && cierre.lng != null && Number.isFinite(cierre.lat) && Number.isFinite(cierre.lng)) { pos = { lat: cierre.lat, lng: cierre.lng }; de = "toque"; }
      else if (rastro) { pos = posicionEn(rastro, cerro); if (pos) de = rastro.fuente; }
      const m = pos && p.lat != null && p.lng != null ? Math.round(metros(pos, { lat: p.lat, lng: p.lng })) : null;
      let enLaParada: boolean | null = m != null ? m <= RADIO_DEL_TOQUE_M : null;
      // Sin posición propia, pero el vehículo estaba en la parada a esa hora: también cuenta.
      if (enLaParada !== true && p._visita && durante(p._visita, cerro, 2 * 60_000)) { enLaParada = true; if (!de) de = "visita"; }
      p.toque = { t: cerro, enLaParada, metros: m, posicion: de };
    }
  }

  // ---- 5. El orden: el del plan vigente contra el real ----
  const conPlan = paradas.filter((p) => p.eta != null).sort((a, b) => a.eta! - b.eta! || (a.sitio ?? -1) - (b.sitio ?? -1));
  let puesto = 0;
  conPlan.forEach((p, i) => {
    const prev = conPlan[i - 1];
    if (!prev || prev.eta !== p.eta || prev.sitio !== p.sitio) puesto++;
    p.puestoPlan = puesto;
  });
  const conReal = paradas.filter((p) => p.llegada != null).sort((a, b) => a.llegada! - b.llegada! || (a.puestoPlan ?? 1e9) - (b.puestoPlan ?? 1e9));
  puesto = 0;
  conReal.forEach((p, i) => {
    const prev = conReal[i - 1];
    if (!prev || !(prev._visita && prev._visita === p._visita) && !(prev.llegada === p.llegada && prev.sitio === p.sitio)) puesto++;
    p.puestoReal = puesto;
  });
  // Dentro de una misma visita no hay orden: comparten la hora de la visita.
  const orden = comparaOrden(paradas.filter((p) => p.puestoPlan != null && p.puestoReal != null).map((p) => ({ clave: p.clave, plan: p.puestoPlan!, real: p.puestoReal! })));
  const fuera = new Set(orden.fueraDeOrden);

  // ---- 6. Diferencias contra lo estimado y contra la ventana ----
  for (const p of paradas) {
    p.fueraDeOrden = fuera.has(p.clave);
    const plan = p.orden.plan[p.tipo] ?? null;
    if (p.llegada != null && plan) {
      // La primera se apuntó en `apuntadaEn`; la vigente, en `rehechaEn` (o en `apuntadaEn` si nunca se rehízo).
      p.primeraPosterior = plan.primera != null && plan.apuntadaEn != null && plan.apuntadaEn > p.llegada;
      const cuando = plan.rehechaEn ?? plan.apuntadaEn;
      p.etaPosterior = cuando != null && cuando > p.llegada;
      if (plan.primera != null) p.difPrimera = Math.round((p.llegada - e.instante(plan.primera)) / 60_000);
      p.difPlan = Math.round((p.llegada - e.instante(plan.eta)) / 60_000);
    }
    if (p.tipo === "D" && p.llegada != null) {
      const v = parseWindow(p.orden.ventana);
      if (v) {
        const dias = Math.floor((p.llegada - e.instante(0)) / 86_400_000);
        p.sobreLaVentana = dias * 1440 + minutoEnZona(new Date(p.llegada).toISOString(), e.zona) - v[1];
      }
    }
  }

  // ---- 7. Las visitas, para el tiempo por parada ----
  const visitas: VisitaDelInforme[] = [];
  if (rastro) {
    const indice = new Map<Visita, number>();
    for (const p of paradas) {
      if (!p._visita || p.sitio == null) continue;
      let i = indice.get(p._visita);
      if (i == null) {
        const s = sitios[p.sitio], v = p._visita;
        i = visitas.length; indice.set(v, i);
        visitas.push({
          lugar: s.tienda ?? p.lugar, clase: "entrega_cliente", tienda: s.tienda, cliente: null, lat: s.lat, lng: s.lng,
          llegada: v.llegada, salida: v.salida, minutos: Math.round(permanenciaS(v) / 6) / 10, fuente: rastro.fuente,
          paradas: [], ordenes: 0, minPlaneados: 0, truncada: v.yaEstaba || v.seQuedo,
        });
      }
      p.visita = i;
      visitas[i].paradas.push(p.clave);
      visitas[i].minPlaneados += p.minPlaneados;
    }
    for (const v of visitas) {
      const suyas = paradas.filter((p) => v.paradas.includes(p.clave));
      const hayP = suyas.some((p) => p.tipo === "P");
      v.clase = hayP ? (v.tienda ? "recogida_tienda" : "recogida_otro") : v.tienda ? "entrega_tienda" : "entrega_cliente";
      v.ordenes = new Set(suyas.map((p) => p.ordenId)).size;
      const clientes = [...new Set(suyas.filter((p) => p.tipo === "D").map((p) => p.cliente).filter((c): c is string => !!c))];
      v.cliente = v.clase === "entrega_cliente" && clientes.length === 1 ? clientes[0] : null;
    }
  }

  // ---- 8. Millas y tiempo: plan contra rastro ----
  const lugaresDelPlan: LatLng[] = [];
  for (const p of conPlan) {
    if (p.lat == null || p.lng == null) continue;
    const prev = lugaresDelPlan[lugaresDelPlan.length - 1];
    if (!prev || metros(prev, { lat: p.lat, lng: p.lng }) > MISMO_SITIO_M) lugaresDelPlan.push({ lat: p.lat, lng: p.lng });
  }
  let millasPlan = 0, minPlan = 0, estimados = 0;
  for (let i = 1; i < lugaresDelPlan.length; i++) {
    const t = e.tramo(lugaresDelPlan[i - 1], lugaresDelPlan[i]);
    millasPlan += t.millas; minPlan += t.minutos; if (t.estimado) estimados++;
  }
  const tramos = Math.max(0, lugaresDelPlan.length - 1);

  const porRastro = paradas.filter((p) => p._visita);
  const primeraLlegada = porRastro.length ? Math.min(...porRastro.map((p) => p._visita!.llegada)) : null;
  const ultimaLlegada = porRastro.length ? Math.max(...porRastro.map((p) => p._visita!.llegada)) : null;
  const ultimaSalida = porRastro.length ? Math.max(...porRastro.map((p) => p._visita!.salida)) : null;
  const tramo0 = rastro ? rastro.puntos[rastro.puntos.length - 1].t - rastro.puntos[0].t : 0;
  const escaso = !!rastro && (rastro.puntos.length < tramo0 / 120_000 && rastro.fuente === "telefono" || tiempoEnHuecos(rastro) > tramo0 / 3);
  const denso = rastro && !escaso ? rastro : null;
  const entreParadas = denso && primeraLlegada != null && ultimaLlegada != null && ultimaLlegada > primeraLlegada;

  let primeraSalida: number | null = null;
  if (denso && rastro && tiendaCerca(rastro.puntos[0])) {
    const lejos = rastro.puntos.findIndex((p) => metros(p, rastro.puntos[0]) > SALIO_M);
    if (lejos > 0) primeraSalida = rastro.puntos[lejos - 1].t;
  }

  // ---- 9. Parado fuera de ruta ----
  const ratos: InformeDelDia["parado"]["ratos"] = [];
  if (denso && rastro && primeraLlegada != null && ultimaLlegada != null) {
    const desde = primeraSalida ?? primeraLlegada;
    for (const s of estancias(rastro)) {
      const a = Math.max(s.desde, desde), b = Math.min(s.hasta, ultimaLlegada);
      if (b - a < 5 * 60_000) continue;
      if (sitios.some((x) => metros(x, s) <= RADIO_DE_PARADA_M + 50) || tiendaCerca(s)) continue;
      // Lo que el chofer declaró como pausa no cuenta.
      let resto = b - a;
      for (const pz of e.pausas ?? []) resto -= Math.max(0, Math.min(b, pz.hasta) - Math.max(a, pz.desde));
      if (resto >= 5 * 60_000) ratos.push({ desde: a, hasta: b, lat: s.lat, lng: s.lng });
    }
  }
  const minutosParado = (r: (typeof ratos)[number]) => {
    let resto = r.hasta - r.desde;
    for (const pz of e.pausas ?? []) resto -= Math.max(0, Math.min(r.hasta, pz.hasta) - Math.max(r.desde, pz.desde));
    return resto / 60_000;
  };

  const conToquePropio = paradas.filter((p) => p.toque);
  return {
    fecha: e.fecha, choferId: e.choferId, chofer: e.chofer,
    rastro: {
      fuente: rastro?.fuente ?? null, camion: rastro?.fuente === "camion" ? e.camion ?? null : null, puntos: rastro?.puntos.length ?? 0,
      desde: rastro ? rastro.puntos[0].t : null, hasta: rastro ? rastro.puntos[rastro.puntos.length - 1].t : null, huecos: rastro ? huecosDelRastro(rastro) : 0, escaso,
    },
    paradas: paradas.map(({ sitio: _s, orden: _o, _visita: _v, ...p }) => p),
    visitas,
    orden: { comparadas: orden.comparadas, fueraDeOrden: orden.fueraDeOrden.length },
    plan: {
      millas: tramos ? Math.round(millasPlan * 10) / 10 : null, minutos: tramos ? Math.round(minPlan) : null, tramos, tramosEstimados: estimados, paradas: conPlan.length,
    },
    real: {
      millasEntreParadas: entreParadas ? millasDelRastro(rastro!, primeraLlegada, ultimaLlegada) : null,
      minutosManejando: entreParadas ? minutosEnMovimiento(rastro!, primeraLlegada, ultimaLlegada) : null,
      millasDelDia: denso ? millasDelRastro(denso) : null,
      primeraSalida, primeraLlegada, ultimaSalida,
    },
    parado: { minutos: denso && primeraLlegada != null ? Math.round(ratos.reduce((s, r) => s + minutosParado(r), 0)) : null, veces: ratos.length, ratos },
    toques: {
      propios: conToquePropio.length, conPosicion: conToquePropio.filter((p) => p.toque!.enLaParada != null).length,
      enLaParada: conToquePropio.filter((p) => p.toque!.enLaParada === true).length, deOtraPersona: paradas.filter((p) => p.toqueDeOtraPersona).length,
    },
  };
}
