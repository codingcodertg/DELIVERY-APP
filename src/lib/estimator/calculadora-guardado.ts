/**
 * Lo que la calculadora de material guarda en este navegador (entradas y ajustes), y cómo se vuelve a leer.
 * Vive aquí para que la calculadora y el visualizador de regadera lean EXACTAMENTE lo mismo: si el vendedor
 * captura las medidas en la calculadora, la regadera las muestra tal cual.
 *
 * Solo navegador: `window.localStorage`. Sin almacenamiento (modo privado, bloqueado) no pasa nada: se usan los valores
 * por defecto.
 */

import {
  AJUSTES_POR_DEFECTO, DISPOSICIONES, ENTRADAS_POR_DEFECTO, PROYECTOS, TAMANOS_DE_LOSETA,
  type AjustesCalculadora, type Disposicion, type EntradasCalculadora, type TamanoDeLoseta, type TipoDeProyecto,
} from "@/lib/estimator/calculadora-material";

/** Dónde se guardan las últimas entradas y ajustes, en este navegador (no en la base). */
export const CLAVE_GUARDADO = "rtg:calculadora-material:v1";

export interface Guardado { entradas: EntradasCalculadora; ajustes: AjustesCalculadora }

/** Lo que haya en el navegador, con cada valor comprobado. Lo que no cuadra vuelve a su valor por defecto. */
export function leeGuardado(): Guardado {
  const base: Guardado = { entradas: ENTRADAS_POR_DEFECTO, ajustes: AJUSTES_POR_DEFECTO };
  try {
    const txt = window.localStorage.getItem(CLAVE_GUARDADO);
    if (!txt) return base;
    const v = JSON.parse(txt) as { entradas?: unknown; ajustes?: unknown } | null;
    return {
      entradas: fusiona(ENTRADAS_POR_DEFECTO, v?.entradas, valorDeEntrada),
      ajustes: fusiona(AJUSTES_POR_DEFECTO, v?.ajustes, (_k, x) => typeof x === "number" && Number.isFinite(x)),
    };
  } catch {
    return base;
  }
}

export function fusiona<T extends object>(base: T, guardado: unknown, valido: (k: keyof T, x: unknown) => boolean): T {
  const salida = { ...base };
  if (!guardado || typeof guardado !== "object") return salida;
  for (const k of Object.keys(base) as (keyof T)[]) {
    const x = (guardado as Record<string, unknown>)[k as string];
    if (valido(k, x)) salida[k] = x as T[keyof T];
  }
  return salida;
}

export function valorDeEntrada(k: keyof EntradasCalculadora, x: unknown): boolean {
  if (k === "proyecto") return PROYECTOS.includes(x as TipoDeProyecto);
  if (k === "disposicion") return DISPOSICIONES.includes(x as Disposicion);
  if (k === "tamanoPared" || k === "tamanoPiso") return TAMANOS_DE_LOSETA.includes(x as TamanoDeLoseta);
  return typeof x === "number" && Number.isFinite(x);
}

export function guardar(g: Guardado): void {
  try { window.localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(g)); } catch { /* sin almacenamiento: no pasa nada */ }
}
