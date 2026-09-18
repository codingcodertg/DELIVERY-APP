import {
  evaluaPlan, parteOrdenesGrandes, planifica, restaDesglose, type Desglose, type Entrada, type Explicacion, type OrdenEntrada, type Parametros, type ParadaRef, type PlanEvaluado,
  type SinAsignar, type Violacion,
} from "@/lib/route-engine";
import { ordenDeLaParte } from "./publicar";

/**
 * El plan del despachador, puntuado con el MISMO modelo que el del motor, y la comparación entre los dos.
 *
 * La hoja da, por orden, el chofer y el número de carga (el orden de sus recogidas). No da el orden de las
 * entregas. Así que el plan manual se completa de la única forma honesta (diseño, §8.1): **se respetan sus
 * choferes y su orden de cargas, y cada entrega se pone en la mejor posición que ese orden de cargas permite.**
 * Es la mejor versión posible del plan del despachador: si aun así el motor sale mejor, la diferencia es suya
 * de verdad; si sale peor, el despachador sabe algo que el modelo no.
 *
 * Se puntúa con `evaluaPlan`: misma matriz, mismo tráfico guardado, mismos tiempos de servicio, mismas
 * ventanas y capacidades, mismos pesos. Aquí no hay red, ni base, ni reloj.
 */

export interface AsignacionDeHoja { ordenId: string; choferId: string; carga: number; renglon: number }

export interface PlanDeLaHoja {
  secuencias: Record<string, ParadaRef[]>;
  evaluado: PlanEvaluado;
  /** Cuántas veces se movió una entrega buscando mejorar. El corte es por cuenta, no por reloj: determinista. */
  movimientos: number;
  convergio: boolean;
  /** Órdenes del día que la hoja NO asigna (no las trae, o las trae sin chofer): las coloca el motor alrededor de
   *  lo que fijó el despachador, para que los dos planes lleven LAS MISMAS órdenes y los totales se puedan comparar. */
  delMotor: string[];
  sinAsignar: SinAsignar[];
}

const MAX_MOVIMIENTOS = 400;

/**
 * Recogidas en el orden de la hoja; entregas donde mejor caen sin tocar ese orden.
 * Determinista: mismo input, mismo plan. El desempate es siempre «la primera posición que lo consigue».
 */
export function planDeLaHoja(entrada: Entrada, parametros: Parametros, asignaciones: readonly AsignacionDeHoja[]): PlanDeLaHoja {
  const partido = parteOrdenesGrandes(entrada.ordenes, entrada.choferes);
  const partesDe = (id: string): OrdenEntrada[] => partido.ordenes.filter((o) => ordenDeLaParte(o.id) === id);
  const evalua = (secuencias: Record<string, ParadaRef[]>) =>
    evaluaPlan({ secuencias, ordenes: partido.ordenes, choferes: entrada.choferes, matriz: entrada.matriz, porHora: entrada.porHora, parametros });
  // Peor = más violaciones; a igualdad, más coste ponderado. Un plan que cumple siempre gana a uno que no.
  const mejorQue = (a: PlanEvaluado, b: PlanEvaluado) => a.violaciones.length < b.violaciones.length || (a.violaciones.length === b.violaciones.length && a.coste.total < b.coste.total);

  const secuencias: Record<string, ParadaRef[]> = Object.fromEntries(entrada.choferes.map((c) => [c.id, [] as ParadaRef[]]));
  const enOrden = [...asignaciones].sort((a, b) => (a.choferId < b.choferId ? -1 : a.choferId > b.choferId ? 1 : a.carga - b.carga || a.renglon - b.renglon));

  // 1) Las recogidas, en el orden de la hoja. Las partes de una orden repartida, seguidas.
  const cargaDe = new Map<string, number>();
  for (const a of enOrden) for (const parte of partesDe(a.ordenId)) { secuencias[a.choferId]?.push({ orden: parte.id, tipo: "P" }); cargaDe.set(parte.id, a.carga); }
  // Un mismo número de carga es UNA parada física: entre dos recogidas de la misma carga no cabe una entrega
  // (sería irse y volver, que es otro orden de cargas que el de la hoja).
  const parteUnaCarga = (sec: readonly ParadaRef[], i: number) =>
    i > 0 && i < sec.length && sec[i - 1].tipo === "P" && sec[i].tipo === "P" && cargaDe.get(sec[i - 1].orden) === cargaDe.get(sec[i].orden);

  // 2) Cada entrega, en la mejor posición DESPUÉS de su recogida.
  const ponEntrega = (choferId: string, orden: string): void => {
    const base = secuencias[choferId];
    const desde = base.findIndex((p) => p.orden === orden && p.tipo === "P") + 1;
    let mejor: { sec: ParadaRef[]; ev: PlanEvaluado } | null = null;
    for (let i = desde; i <= base.length; i++) {
      if (parteUnaCarga(base, i)) continue;
      const sec = [...base.slice(0, i), { orden, tipo: "D" as const }, ...base.slice(i)];
      const ev = evalua({ ...secuencias, [choferId]: sec });
      if (!mejor || mejorQue(ev, mejor.ev)) mejor = { sec, ev };
    }
    secuencias[choferId] = mejor!.sec;
  };
  for (const a of enOrden) if (secuencias[a.choferId]) for (const parte of partesDe(a.ordenId)) ponEntrega(a.choferId, parte.id);

  // 3) Mejora local: sacar una entrega y volver a ponerla donde mejor caiga, hasta que ninguna mejore.
  let actual = evalua(secuencias), movimientos = 0, mejoro = true;
  while (mejoro && movimientos < MAX_MOVIMIENTOS) {
    mejoro = false;
    for (const c of entrada.choferes) {
      for (const d of (secuencias[c.id] ?? []).filter((p) => p.tipo === "D")) {
        if (movimientos >= MAX_MOVIMIENTOS) break;
        const antes = secuencias[c.id];
        secuencias[c.id] = antes.filter((p) => !(p.orden === d.orden && p.tipo === "D"));
        ponEntrega(c.id, d.orden);
        const ev = evalua(secuencias);
        if (mejorQue(ev, actual)) { actual = ev; mejoro = true; movimientos++; } else secuencias[c.id] = antes;
      }
    }
  }
  // 4) Lo que la hoja no asigna lo pone el motor, SIN mover nada de lo que puso el despachador.
  const enLaHoja = new Set(asignaciones.map((a) => a.ordenId));
  const resto = entrada.ordenes.filter((o) => !enLaHoja.has(o.id)).map((o) => o.id).sort();
  if (!resto.length) return { secuencias, evaluado: actual, movimientos, convergio: !mejoro, delMotor: [], sinAsignar: [] };
  const completo = planifica({ ...entrada, secuenciaFijada: secuencias }, parametros);
  return {
    secuencias: Object.fromEntries(completo.rutas.map((r) => [r.chofer, r.paradas.map((p) => ({ orden: p.orden, tipo: p.tipo }))])),
    evaluado: { rutas: completo.rutas, coste: completo.coste, violaciones: completo.violaciones }, movimientos, convergio: !mejoro && completo.convergio,
    delMotor: resto, sinAsignar: completo.sinAsignar,
  };
}

// ---------------------------------------------------------------------------------------------------------------

export type DiferenciaDeOrden = {
  orden: string;
  choferHoja: string; choferMotor: string | null;
  /** Número de carga en la hoja (empieza en 0) y etiqueta que eso es en pantalla (P1, P2…). */
  cargaHoja: number; etiquetaHoja: string;
  /** La posición de su recogida entre las PARADAS FÍSICAS de recogida de su chofer en el plan del motor (0 = la primera). */
  cargaMotor: number | null;
  mismoChofer: boolean; mismaCarga: boolean | null;
  /** Si el motor la puso con otro chofer: lo que le costaría al plan del motor ponerla con el de la hoja. */
  comoEnLaHoja: { diferencia: Desglose | null; noPuede: string | null } | null;
};

export interface Comparacion {
  total: { hoja: Desglose; motor: Desglose; diferencia: Desglose };
  porChofer: { choferId: string; hoja: ResumenDeRuta; motor: ResumenDeRuta }[];
  ordenes: DiferenciaDeOrden[];
  cuenta: { comparadas: number; mismoChofer: number; mismaCarga: number };
  violaciones: { hoja: Violacion[]; motor: Violacion[] };
}
export interface ResumenDeRuta { ordenes: number; manejoMin: number; millas: number; tardeMin: number; paradasTarde: number; fin: number | null }

function resumenDe(plan: PlanEvaluado, choferId: string): ResumenDeRuta {
  const r = plan.rutas.find((x) => x.chofer === choferId);
  if (!r || !r.paradas.length) return { ordenes: 0, manejoMin: 0, millas: 0, tardeMin: 0, paradasTarde: 0, fin: null };
  return {
    ordenes: new Set(r.paradas.map((p) => ordenDeLaParte(p.orden))).size, manejoMin: r.manejoMin, millas: Math.round(r.millas * 100) / 100, tardeMin: r.tardeMin,
    paradasTarde: r.paradas.filter((p) => p.tardeMin > 0).length, fin: r.fin,
  };
}

/** En qué parada FÍSICA de recogida (0, 1, 2…) cae cada orden de un chofer: recogidas seguidas en el mismo punto son una. */
function cargasDelMotor(plan: PlanEvaluado): Map<string, number> {
  const r = new Map<string, number>();
  for (const ruta of plan.rutas) {
    let n = -1, ultimo: string | null = null, veniaDeRecoger = false;
    for (const p of ruta.paradas) {
      if (p.tipo === "P") {
        if (!(veniaDeRecoger && ultimo === p.punto)) n++;
        const id = ordenDeLaParte(p.orden);
        if (!r.has(id)) r.set(id, n);
        ultimo = p.punto; veniaDeRecoger = true;
      } else veniaDeRecoger = false;
    }
  }
  return r;
}

export function comparaConLaHoja(
  hoja: PlanEvaluado, motor: PlanEvaluado, asignaciones: readonly AsignacionDeHoja[], explicaciones: readonly Explicacion[] | null | undefined,
  choferes: readonly { id: string }[],
): Comparacion {
  const choferMotor = new Map<string, string>();
  for (const r of motor.rutas) for (const p of r.paradas) choferMotor.set(ordenDeLaParte(p.orden), r.chofer);
  const cargaMotor = cargasDelMotor(motor);
  // La hoja numera sus cargas como quiere (0, 0, 2, 5…): lo que se compara es el PUESTO, no el número.
  const puestoHoja = new Map<string, number>();
  for (const c of new Set(asignaciones.map((a) => a.choferId))) {
    const suyas = [...new Set(asignaciones.filter((a) => a.choferId === c).map((a) => a.carga))].sort((x, y) => x - y);
    for (const a of asignaciones.filter((x) => x.choferId === c)) puestoHoja.set(a.ordenId, suyas.indexOf(a.carga));
  }

  const ordenes = [...asignaciones].sort((a, b) => (a.ordenId < b.ordenId ? -1 : 1)).map((a): DiferenciaDeOrden => {
    const cm = choferMotor.get(a.ordenId) ?? null;
    const mismoChofer = cm === a.choferId;
    const suCarga = cargaMotor.get(a.ordenId) ?? null;
    const alt = mismoChofer || !cm ? null : (explicaciones ?? []).filter((e) => ordenDeLaParte(e.orden) === a.ordenId).flatMap((e) => e.alternativas).find((x) => x.chofer === a.choferId) ?? null;
    return {
      orden: a.ordenId, choferHoja: a.choferId, choferMotor: cm, cargaHoja: a.carga, etiquetaHoja: `P${(puestoHoja.get(a.ordenId) ?? 0) + 1}`, cargaMotor: suCarga,
      mismoChofer, mismaCarga: mismoChofer && suCarga !== null ? suCarga === puestoHoja.get(a.ordenId) : null,
      comoEnLaHoja: alt ? { diferencia: alt.diferencia, noPuede: alt.diferencia ? null : (alt.motivo ?? "no_permitido") } : null,
    };
  });

  return {
    total: { hoja: hoja.coste, motor: motor.coste, diferencia: restaDesglose(hoja.coste, motor.coste) },
    porChofer: choferes.map((c) => ({ choferId: c.id, hoja: resumenDe(hoja, c.id), motor: resumenDe(motor, c.id) })).filter((x) => x.hoja.ordenes > 0 || x.motor.ordenes > 0),
    ordenes,
    cuenta: { comparadas: ordenes.length, mismoChofer: ordenes.filter((o) => o.mismoChofer).length, mismaCarga: ordenes.filter((o) => o.mismaCarga === true).length },
    violaciones: { hoja: hoja.violaciones, motor: motor.violaciones },
  };
}
