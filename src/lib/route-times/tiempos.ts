import {
  bloqueDe, evaluaPlan, MINUTOS_POR_BLOQUE, parteOrdenesGrandes, planifica,
  type Entrada, type Matriz, type ParadaRef, type Parametros, type Plan, type Punto, type TiemposPorHora, type Tramo,
} from "@/lib/route-engine";
import {
  CADUCIDAD_DIAS, claveDePunto, claveSinTrafico, diaDeLaSemana, textoDeClave, type ClaveDeTiempo, type LatLng,
} from "./claves";
import type { NombreDeProveedor, ProveedorDeTiempos } from "./proveedores";

/**
 * Los tiempos de viaje del motor de rutas: matriz base cacheada y tráfico en cascada (D-318).
 * Diseño en `docs/route-algorithm-design.md`, §3 y §5.
 *
 * La idea, en una frase: **nunca se pide una matriz completa con tráfico.** Se pide una matriz base SIN
 * tráfico —barata, y que casi siempre sale de la caché— para que el motor decida; y después, solo sobre las
 * rutas que salieron, se pide cada tramo CON tráfico a la hora a la que ese camión pasa por ahí.
 *
 * Todo lo que toca el mundo llega inyectado —la caché, los proveedores, la hora—, así que aquí no hay ni una
 * llamada de red ni un reloj: se prueba entero con dobles, y no gasta un céntimo.
 */

export interface FilaDeCache extends ClaveDeTiempo {
  minutos: number;
  millas: number;
  proveedor: NombreDeProveedor;
  /** ISO. De aquí sale si sigue valiendo, y cuánto se ha gastado hoy. */
  pedidoEl: string;
}

export interface CacheDeTiempos {
  lee(claves: readonly ClaveDeTiempo[]): Promise<FilaDeCache[]>;
  escribe(filas: readonly FilaDeCache[]): Promise<void>;
  /** Cuántas respuestas DE PAGO se guardaron desde `desdeISO`: elementos de matriz y tramos con tráfico. */
  gastoDesde(desdeISO: string): Promise<{ elementos: number; tramos: number }>;
}

/** El freno, en el código y no solo en el papel (`CLAUDE.md`: «nunca en bucle»). Por corrida y por día.
 *  Con el tamaño medido (máximo 14 órdenes) un día normal queda muy por debajo; esto es para el día raro. */
export interface Presupuesto { elementosPorCorrida: number; tramosPorCorrida: number; elementosPorDia: number; tramosPorDia: number }
export const PRESUPUESTO_POR_DEFECTO: Presupuesto = { elementosPorCorrida: 400, tramosPorCorrida: 80, elementosPorDia: 1500, tramosPorDia: 400 };

const DIA_MS = 24 * 60 * 60 * 1000;

/** ¿Sigue valiendo una respuesta guardada? 90 días sin tráfico, 28 con él. */
export function estaVigente(fila: Pick<FilaDeCache, "trafico" | "pedidoEl">, ahoraISO: string): boolean {
  const edad = Date.parse(ahoraISO) - Date.parse(fila.pedidoEl);
  const tope = (fila.trafico ? CADUCIDAD_DIAS.conTrafico : CADUCIDAD_DIAS.sinTrafico) * DIA_MS;
  return Number.isFinite(edad) && edad >= 0 && edad <= tope;
}

/** Una caché en memoria: para las pruebas, y para el demo local. */
export function cacheEnMemoria(inicial: readonly FilaDeCache[] = []): CacheDeTiempos & { filas: Map<string, FilaDeCache> } {
  const filas = new Map(inicial.map((f) => [textoDeClave(f), f]));
  return {
    filas,
    async lee(claves) { return claves.map((k) => filas.get(textoDeClave(k))).filter((f): f is FilaDeCache => !!f); },
    async escribe(nuevas) { for (const f of nuevas) filas.set(textoDeClave(f), f); },
    async gastoDesde(desdeISO) {
      const hoy = [...filas.values()].filter((f) => f.proveedor === "google" && f.pedidoEl >= desdeISO);
      return { elementos: hoy.filter((f) => !f.trafico).length, tramos: hoy.filter((f) => f.trafico).length };
    },
  };
}

export interface Dependencias {
  cache: CacheDeTiempos;
  /** En orden de preferencia. El último debería ser el estimado, que nunca falla. */
  proveedores: readonly ProveedorDeTiempos[];
  ahoraISO: string;
  presupuesto?: Presupuesto;
}

export interface InformeDeTiempos {
  deCache: number;
  pedidos: number;
  /** El peor proveedor que hubo que usar: si sale «estimado», el plan lo dice en pantalla. */
  proveedor: NombreDeProveedor | "cache";
  /** Se llegó al tope de llamadas y lo que faltaba se resolvió sin el proveedor de pago. */
  presupuestoAgotado: boolean;
}

const PEOR: Record<InformeDeTiempos["proveedor"], number> = { cache: 0, google: 1, osrm: 2, estimado: 3 };
const elPeor = (a: InformeDeTiempos["proveedor"], b: InformeDeTiempos["proveedor"]) => (PEOR[b] > PEOR[a] ? b : a);
const inicioDelDia = (ahoraISO: string) => `${ahoraISO.slice(0, 10)}T00:00:00.000Z`;

/**
 * La matriz base, sin tráfico, entre todos los puntos del día. Solo se pide lo que no está en la caché, y
 * origen a origen, para pagar exactamente los elementos que faltan y ninguno más.
 */
export async function matrizBase(puntos: Readonly<Record<Punto, LatLng>>, deps: Dependencias): Promise<{ matriz: Matriz; informe: InformeDeTiempos }> {
  const presupuesto = deps.presupuesto ?? PRESUPUESTO_POR_DEFECTO;
  const nombres = Object.keys(puntos).sort();
  const clave = (n: Punto) => claveDePunto(puntos[n]);
  const pares = nombres.flatMap((a) => nombres.filter((b) => b !== a).map((b) => [a, b] as const));

  const guardadas = (await deps.cache.lee(pares.map(([a, b]) => claveSinTrafico(clave(a), clave(b))))).filter((f) => estaVigente(f, deps.ahoraISO));
  const porClave = new Map(guardadas.map((f) => [textoDeClave(f), f]));
  const matriz: Matriz = Object.fromEntries(nombres.map((n) => [n, {}]));
  const faltan: (readonly [Punto, Punto])[] = [];
  for (const [a, b] of pares) {
    const f = porClave.get(textoDeClave(claveSinTrafico(clave(a), clave(b))));
    if (f) matriz[a][b] = { minutos: f.minutos, millas: f.millas }; else faltan.push([a, b]);
  }
  const informe: InformeDeTiempos = { deCache: pares.length - faltan.length, pedidos: 0, proveedor: "cache", presupuestoAgotado: false };
  if (!faltan.length) return { matriz, informe };

  const gastado = (await deps.cache.gastoDesde(inicioDelDia(deps.ahoraISO))).elementos;
  const cabe = faltan.length <= presupuesto.elementosPorCorrida && gastado + faltan.length <= presupuesto.elementosPorDia;

  const origenes = [...new Set(faltan.map(([a]) => a))];
  for (const a of origenes) {
    const destinos = faltan.filter(([o]) => o === a).map(([, b]) => b);
    let fila: (Tramo | null)[] | null = null;
    let quien: NombreDeProveedor = "estimado";
    for (const p of deps.proveedores) {
      // El de pago, solo si cabe en el tope. Los demás no cuestan.
      if (p.nombre === "google" && !cabe) { informe.presupuestoAgotado = true; continue; }
      try { fila = (await p.matriz([puntos[a]], destinos.map((b) => puntos[b])))[0] ?? null; quien = p.nombre; if (fila) break; }
      catch { fila = null; }
    }
    const nuevas: FilaDeCache[] = [];
    destinos.forEach((b, j) => {
      const t = fila?.[j];
      if (!t) return;
      matriz[a][b] = t;
      informe.pedidos++;
      // Solo se guarda lo que contestó el proveedor PREFERIDO. Guardar 90 días la respuesta de un respaldo
      // sería no volver a preguntarle al bueno en tres meses, sin que nadie lo decidiera.
      if (quien === deps.proveedores[0]?.nombre) nuevas.push({ ...claveSinTrafico(clave(a), clave(b)), ...t, proveedor: quien, pedidoEl: deps.ahoraISO });
    });
    informe.proveedor = elPeor(informe.proveedor, quien);
    if (nuevas.length) await deps.cache.escribe(nuevas);
  }
  return { matriz, informe };
}

/**
 * El instante UTC de un minuto del día en la zona del negocio, con su cambio de hora. La misma cuenta que
 * `departureTimeFor` (`google-routes.ts`), pero con minutos y sin mirar el reloj.
 */
export function instanteLocalISO(fechaISO: string, minutoDelDia: number, zona: string): string | null {
  if (diaDeLaSemana(fechaISO) === null) return null;
  const hh = String(Math.floor(minutoDelDia / 60)).padStart(2, "0"), mm = String(minutoDelDia % 60).padStart(2, "0");
  const tanteo = Date.parse(`${fechaISO}T${hh}:${mm}:00Z`);
  if (Number.isNaN(tanteo)) return null;
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(tanteo));
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const comoUTC = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute"), n("second"));
  return new Date(tanteo - (comoUTC - tanteo)).toISOString();
}

export type TramoDeRuta = { a: Punto; b: Punto; salidaMin: number };

/** Los tramos que recorre un plan, cada uno con la hora a la que ese camión SALE del punto anterior. */
export function tramosDelPlan(plan: Pick<Plan, "rutas">, entrada: Pick<Entrada, "choferes">): TramoDeRuta[] {
  const tramos: TramoDeRuta[] = [];
  for (const r of plan.rutas) {
    const c = entrada.choferes.find((x) => x.id === r.chofer);
    if (!c || !r.paradas.length) continue;
    let sitio = c.base, salida = c.entrada;
    for (const p of r.paradas) {
      if (p.punto !== sitio) tramos.push({ a: sitio, b: p.punto, salidaMin: salida });
      sitio = p.punto; salida = p.salida;
    }
    if (c.vuelveABase && sitio !== c.base) tramos.push({ a: sitio, b: c.base, salidaMin: salida });
  }
  return tramos;
}

/**
 * Tráfico para unos tramos concretos: cada uno a la media hora en que se sale, para ese día de la semana.
 * Un tramo cuya hora ya pasó no se pide (Google rechaza el pasado) y se queda con el tiempo base.
 */
export async function traficoDeTramos(
  tramos: readonly TramoDeRuta[], fechaISO: string, puntos: Readonly<Record<Punto, LatLng>>, zona: string, deps: Dependencias,
): Promise<{ porHora: TiemposPorHora; informe: InformeDeTiempos }> {
  const presupuesto = deps.presupuesto ?? PRESUPUESTO_POR_DEFECTO;
  const informe: InformeDeTiempos = { deCache: 0, pedidos: 0, proveedor: "cache", presupuestoAgotado: false };
  const porHora: TiemposPorHora = {};
  const dia = diaDeLaSemana(fechaISO);
  const conTrafico = deps.proveedores.find((p) => p.conTrafico);
  if (dia === null || !conTrafico) return { porHora, informe };

  const pon = (t: TramoDeRuta, bloque: number, v: Tramo) => { ((porHora[t.a] ??= {})[t.b] ??= {})[bloque] = v; };
  const distintos = new Map<string, { t: TramoDeRuta; bloque: number; k: ClaveDeTiempo }>();
  for (const t of tramos) {
    if (!puntos[t.a] || !puntos[t.b]) continue;
    const bloque = bloqueDe(t.salidaMin);
    const k: ClaveDeTiempo = { origen: claveDePunto(puntos[t.a]), destino: claveDePunto(puntos[t.b]), dia, bloque, trafico: true };
    distintos.set(textoDeClave(k), { t, bloque, k });
  }
  const guardadas = new Map((await deps.cache.lee([...distintos.values()].map((d) => d.k))).filter((f) => estaVigente(f, deps.ahoraISO)).map((f) => [textoDeClave(f), f]));
  let gastado = (await deps.cache.gastoDesde(inicioDelDia(deps.ahoraISO))).tramos;

  for (const [texto, d] of [...distintos].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const f = guardadas.get(texto);
    if (f) { pon(d.t, d.bloque, { minutos: f.minutos, millas: f.millas }); informe.deCache++; continue; }
    if (informe.pedidos >= presupuesto.tramosPorCorrida || gastado >= presupuesto.tramosPorDia) { informe.presupuestoAgotado = true; continue; }
    // A la MITAD de la media hora: el valor guardado representa al bloque entero, no a su primer minuto.
    const salidaISO = instanteLocalISO(fechaISO, d.bloque * MINUTOS_POR_BLOQUE + MINUTOS_POR_BLOQUE / 2, zona);
    if (!salidaISO || salidaISO <= deps.ahoraISO) continue;
    try {
      const v = await conTrafico.tramo(puntos[d.t.a], puntos[d.t.b], salidaISO);
      if (!v) continue;
      pon(d.t, d.bloque, v);
      informe.pedidos++; gastado++;
      informe.proveedor = elPeor(informe.proveedor, conTrafico.nombre);
      await deps.cache.escribe([{ ...d.k, ...v, proveedor: conTrafico.nombre, pedidoEl: deps.ahoraISO }]);
    } catch { /* sin tráfico para este tramo: vale el tiempo base, y el plan no se cae por eso */ }
  }
  return { porHora, informe };
}

const mezcla = (a: TiemposPorHora, b: TiemposPorHora): TiemposPorHora => {
  const r: TiemposPorHora = JSON.parse(JSON.stringify(a));
  for (const [o, ds] of Object.entries(b)) for (const [d, bs] of Object.entries(ds)) for (const [bl, v] of Object.entries(bs)) ((r[o] ??= {})[d] ??= {})[Number(bl)] = v;
  return r;
};

/** Dos vueltas como mucho: planificar, poner tráfico a lo que salió, y si con tráfico algo se rompe o llega
 *  más tarde, volver a planificar con esos tiempos. Más vueltas es pagar por perseguir un punto fijo. */
export const MAX_VUELTAS_DE_TRAFICO = 2;

export interface PlanConTiempos {
  plan: Plan; porHora: TiemposPorHora; vueltas: number; informe: InformeDeTiempos;
  /** Se agotaron las vueltas y, con tráfico, el plan todavía incumple algo. Sus horas son las de verdad y sus
   *  violaciones van en `plan.violaciones`: no se esconde, se enseña. */
  sinResolver: boolean;
}

/**
 * Planifica con la matriz base y corrige con tráfico en cascada.
 *
 * **Qué es reproducible y qué no** (corregido en el incremento 4; la primera versión decía de más). El
 * `porHora` solo trae tráfico para los tramos de las secuencias que se llegaron a probar. Por eso:
 *   · EVALUAR la secuencia guardada con la matriz y ese `porHora` da exactamente las mismas horas, siempre.
 *     Eso es lo que hay que guardar con el plan, y lo que lo hace auditable.
 *   · Volver a PLANIFICAR con ese `porHora` NO tiene por qué dar el mismo plan: cualquier otra secuencia
 *     usa tramos sin tráfico pedido, que parecen más baratos de lo que son. Planificar es reproducible con
 *     la misma entrada Y la misma caché, no con la tabla parcial.
 *
 * De ahí la regla de abajo: **el plan que se devuelve está SIEMPRE evaluado con el tráfico de sus propios
 * tramos.** Nunca sale un plan cuya última re-planificación dejó tramos con la hora optimista de la base.
 */
export async function planificaConTrafico(
  entrada: Entrada, parametros: Parametros, fechaISO: string, puntos: Readonly<Record<Punto, LatLng>>, zona: string, deps: Dependencias,
): Promise<PlanConTiempos> {
  let porHora: TiemposPorHora = entrada.porHora ?? {};
  let plan = planifica({ ...entrada, porHora }, parametros);
  const informe: InformeDeTiempos = { deCache: 0, pedidos: 0, proveedor: "cache", presupuestoAgotado: false };
  let vueltas = 0;
  let sinResolver = false;
  for (;;) {
    const t = await traficoDeTramos(tramosDelPlan(plan, entrada), fechaISO, puntos, zona, deps);
    informe.deCache += t.informe.deCache; informe.pedidos += t.informe.pedidos;
    informe.proveedor = elPeor(informe.proveedor, t.informe.proveedor);
    informe.presupuestoAgotado ||= t.informe.presupuestoAgotado;
    // Sin nadie que sepa de tráfico (o sin nada nuevo que añadir en la primera vuelta), el plan es el base.
    if (!Object.keys(t.porHora).length && vueltas === 0) break;
    porHora = mezcla(porHora, t.porHora);

    // La MISMA secuencia, ahora con tráfico. (Las órdenes, partidas igual que las partió el motor: una
    // mayor que el camión va en a/b/c, y partirlas es determinista.)
    //  Si aguanta sin romperse ni llegar más tarde, no hay que replanificar.
    const secuencias: Record<string, ParadaRef[]> = Object.fromEntries(plan.rutas.map((r) => [r.chofer, r.paradas.map((p) => ({ orden: p.orden, tipo: p.tipo }))]));
    const conTrafico = evaluaPlan({ secuencias, ordenes: parteOrdenesGrandes(entrada.ordenes, entrada.choferes).ordenes, choferes: entrada.choferes, matriz: entrada.matriz, porHora, parametros });
    const aguanta = !conTrafico.violaciones.length && conTrafico.coste.tardeMin <= plan.coste.tardeMin;
    // Las horas de verdad, SIEMPRE: aguante o no, el plan se queda con su secuencia evaluada con su tráfico.
    plan = { ...plan, rutas: conTrafico.rutas, coste: conTrafico.coste, violaciones: conTrafico.violaciones };
    vueltas++;
    if (aguanta) break;
    if (vueltas >= MAX_VUELTAS_DE_TRAFICO) { sinResolver = conTrafico.violaciones.length > 0; break; }
    plan = planifica({ ...entrada, porHora }, parametros);
  }
  return { plan, porHora, vueltas, informe, sinResolver };
}
