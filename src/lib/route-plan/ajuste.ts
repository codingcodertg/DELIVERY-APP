import {
  evaluaPlan, parteOrdenesGrandes, type Entrada, type Parametros, type ParadaRef, type Violacion,
} from "@/lib/route-engine";
import type { NamedLocation } from "@/lib/types";
import type { FilaDePlan } from "./borrador";
import { filasDeParadas, type FilaDeParada } from "./entrada";
import { escriturasAlPublicar } from "./publicar";

/**
 * Ajustar a mano un plan en BORRADOR (D-NEXT): reordenar una parada, pasar una orden a otro chofer, fijarla.
 *
 * Tres ideas, y las tres son del diseño (§7):
 *   · **Se revalida, no se replanifica.** Tras el movimiento, las secuencias —tal como las dejó la persona— se
 *     pasan por `evaluaPlan` con la matriz y el tráfico guardados. Salen horas, carga y violaciones nuevas. No se
 *     llama a nadie: ni al motor de planificar ni a un proveedor de tiempos.
 *   · **Se advierte, no se bloquea.** Si el ajuste llega tarde a una ventana o sobrecarga el camión, se dice y se
 *     guarda igual: quien despacha sabe cosas que el motor no. Lo ÚNICO que se rechaza es lo que no es una ruta:
 *     entregar antes de recoger, o una orden repartida entre dos choferes.
 *   · **El historial no se pisa.** Un ajuste es un plan NUEVO (`source = 'manual_edit'`, `parent_plan_id` = el
 *     anterior), y el anterior pasa a descartado. Si guardar falla a medias, el anterior sigue entero.
 */

export type Secuencias = Record<string, ParadaRef[]>;
export interface EstadoDelPlan { secuencias: Secuencias; fijadas: string[] }

export type Movimiento =
  | { tipo: "sube"; chofer: string; indice: number }
  | { tipo: "baja"; chofer: string; indice: number }
  | { tipo: "a_chofer"; orden: string; chofer: string }
  | { tipo: "fija"; orden: string }
  | { tipo: "suelta"; orden: string };

export type ErrorDeMovimiento = "chofer_desconocido" | "parada_desconocida" | "orden_desconocida" | "en_el_borde" | "entrega_antes_de_recoger" | "ya_esta_ahi";

/** El movimiento que manda el cliente, comprobado campo a campo: lo que no encaja es `null`. */
export function movimientoValido(m: unknown): Movimiento | null {
  if (!m || typeof m !== "object") return null;
  const x = m as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 80 ? v : null);
  if (x.tipo === "sube" || x.tipo === "baja") {
    const chofer = texto(x.chofer);
    return chofer && Number.isInteger(x.indice) ? { tipo: x.tipo, chofer, indice: x.indice as number } : null;
  }
  if (x.tipo === "a_chofer") {
    const chofer = texto(x.chofer), orden = texto(x.orden);
    return chofer && orden ? { tipo: "a_chofer", chofer, orden } : null;
  }
  if (x.tipo === "fija" || x.tipo === "suelta") {
    const orden = texto(x.orden);
    return orden ? { tipo: x.tipo, orden } : null;
  }
  return null;
}

/** De las filas guardadas a las secuencias que entiende el motor. Las paradas sin chofer no son de ninguna ruta. */
export function estadoDeParadas(paradas: readonly Pick<FilaDeParada, "driver_id" | "seq" | "kind" | "order_ref" | "pinned">[]): EstadoDelPlan {
  const secuencias: Secuencias = {};
  const fijadas = new Set<string>();
  for (const p of [...paradas].filter((x) => !!x.driver_id).sort((a, b) => a.seq - b.seq)) {
    (secuencias[p.driver_id] ??= []).push({ orden: p.order_ref, tipo: p.kind });
    if (p.pinned) fijadas.add(p.order_ref);
  }
  return { secuencias, fijadas: [...fijadas].sort() };
}

/** Una ruta es una ruta si cada orden se recoge antes de entregarse, con el MISMO chofer, una vez cada cosa. */
export function esUnaRuta(secuencias: Secuencias): boolean {
  const visto = new Map<string, { chofer: string; p: number; d: number }>();
  for (const [chofer, sec] of Object.entries(secuencias)) {
    for (const [k, parada] of sec.entries()) {
      const v = visto.get(parada.orden) ?? { chofer, p: -1, d: -1 };
      if (v.chofer !== chofer) return false;
      if (parada.tipo === "P") { if (v.p >= 0) return false; v.p = k; } else { if (v.d >= 0) return false; v.d = k; }
      visto.set(parada.orden, v);
    }
  }
  return [...visto.values()].every((v) => v.p >= 0 && v.d > v.p);
}

export function aplicaMovimiento(estado: EstadoDelPlan, m: Movimiento, choferes: readonly string[]): EstadoDelPlan | { error: ErrorDeMovimiento } {
  const secuencias: Secuencias = Object.fromEntries(Object.entries(estado.secuencias).map(([c, s]) => [c, [...s]]));
  const existe = (orden: string) => Object.values(secuencias).some((s) => s.some((p) => p.orden === orden));

  if (m.tipo === "fija" || m.tipo === "suelta") {
    if (!existe(m.orden)) return { error: "orden_desconocida" };
    const fijadas = new Set(estado.fijadas);
    if (m.tipo === "fija") fijadas.add(m.orden); else fijadas.delete(m.orden);
    return { secuencias, fijadas: [...fijadas].sort() };
  }

  if (!choferes.includes(m.chofer)) return { error: "chofer_desconocido" };

  if (m.tipo === "a_chofer") {
    const origen = Object.keys(secuencias).find((c) => secuencias[c].some((p) => p.orden === m.orden));
    if (!origen) return { error: "orden_desconocida" };
    if (origen === m.chofer) return { error: "ya_esta_ahi" };
    secuencias[origen] = secuencias[origen].filter((p) => p.orden !== m.orden);
    // Al final de la ruta del otro: recoger y, enseguida, entregar. Desde ahí la persona la sube adonde quiera.
    secuencias[m.chofer] = [...(secuencias[m.chofer] ?? []), { orden: m.orden, tipo: "P" }, { orden: m.orden, tipo: "D" }];
    // Moverla a mano ES decidir dónde va: queda fijada, para que «planificar de nuevo» no la devuelva.
    return { secuencias, fijadas: [...new Set([...estado.fijadas, m.orden])].sort() };
  }

  const sec = secuencias[m.chofer] ?? [];
  if (!Number.isInteger(m.indice) || m.indice < 0 || m.indice >= sec.length) return { error: "parada_desconocida" };
  const otro = m.tipo === "sube" ? m.indice - 1 : m.indice + 1;
  if (otro < 0 || otro >= sec.length) return { error: "en_el_borde" };
  [sec[m.indice], sec[otro]] = [sec[otro], sec[m.indice]];
  secuencias[m.chofer] = sec;
  if (!esUnaRuta(secuencias)) return { error: "entrega_antes_de_recoger" };
  return { secuencias, fijadas: [...new Set([...estado.fijadas, sec[otro].orden])].sort() };
}

/** Lo que se guarda de un plan para poder revalidarlo: su foto, sus parámetros y lo que el motor dijo. */
export type PlanGuardado = Pick<FilaDePlan, "plan_date" | "algorithm_version" | "params" | "input" | "result" | "provider" | "traffic" | "converged">;

export interface Ajustado {
  plan: FilaDePlan;
  paradas: FilaDeParada[];
  /** Lo que el ajuste incumple. Se enseña; no impide guardar ni publicar. */
  violaciones: Violacion[];
  /** Tramos del plan ajustado para los que no hay tráfico guardado: sus horas son las de la matriz base. */
  tramosSinTrafico: number;
}

export function revalida(guardado: PlanGuardado, estado: EstadoDelPlan, padre: string, tiendas: readonly NamedLocation[]): Ajustado {
  const entrada = guardado.input.entrada as Entrada;
  const parametros = guardado.params as unknown as Parametros;
  const ordenes = parteOrdenesGrandes(entrada.ordenes, entrada.choferes).ordenes;
  const fijadas = new Set(estado.fijadas.flatMap((o) => [`P:${o}`, `D:${o}`]));
  const r = evaluaPlan({ secuencias: estado.secuencias, ordenes, choferes: entrada.choferes, matriz: entrada.matriz, porHora: entrada.porHora, parametros, fijadas });

  // ¿Cuántos tramos de lo que quedó NO tienen tráfico guardado? Solo importa si el plan se hizo con tráfico.
  const puntoDe = new Map(ordenes.map((o) => [o.id, o]));
  let tramosSinTrafico = 0;
  if (guardado.traffic) {
    for (const c of entrada.choferes) {
      let desde: string = c.base;
      for (const p of estado.secuencias[c.id] ?? []) {
        const o = puntoDe.get(p.orden);
        const hasta = p.tipo === "P" ? o?.origen : o?.destino;
        if (!hasta) continue;
        if (hasta !== desde && !entrada.porHora?.[desde]?.[hasta]) tramosSinTrafico++;
        desde = hasta;
      }
    }
  }

  const plan: FilaDePlan = {
    plan_date: guardado.plan_date, source: "manual_edit", parent_plan_id: padre, algorithm_version: guardado.algorithm_version,
    params: guardado.params, input: guardado.input,
    result: { ...guardado.result, coste: r.coste, violaciones: r.violaciones, tramosSinTrafico, fijadas: estado.fijadas },
    writes: escriturasAlPublicar(r, entrada.choferes),
    provider: guardado.provider, traffic: guardado.traffic, converged: guardado.converged,
    total_minutes: r.rutas.reduce((s, x) => s + x.duracionMin, 0), total_miles: Math.round(r.coste.millas * 100) / 100,
    late_minutes: r.coste.tardeMin, unassigned_count: guardado.result.sinAsignar.length + guardado.result.fuera.length,
  };
  return { plan, paradas: filasDeParadas(r, { ordenes: entrada.ordenes, choferes: entrada.choferes }, guardado.input.puntos, tiendas), violaciones: r.violaciones, tramosSinTrafico };
}
