/**
 * Lo que la calculadora de material guarda en este navegador (entradas y ajustes), y cómo se vuelve a leer.
 * Vive aquí para que la calculadora y el visualizador de regadera lean EXACTAMENTE lo mismo: si el vendedor
 * captura las medidas en la calculadora, la regadera las muestra tal cual.
 *
 * Solo navegador: `window.localStorage`. Sin almacenamiento (modo privado, bloqueado) no pasa nada: se usan los valores
 * por defecto.
 */

import {
  AJUSTES_POR_DEFECTO, DISPOSICIONES, ENTRADAS_POR_DEFECTO, MAX_FILAS_DE_MEDIDA, PROYECTOS, TAMANOS_DE_LOSETA,
  type AjustesCalculadora, type Disposicion, type EntradasCalculadora, type Habitacion, type Muro, type TamanoDeLoseta,
  type TipoDeProyecto,
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
    const entradas = fusiona(ENTRADAS_POR_DEFECTO, v?.entradas, valorDeEntrada);
    const crudo = (v?.entradas && typeof v.entradas === "object" ? v.entradas : {}) as Record<string, unknown>;
    // Lo guardado antes de las calculadoras de piso y de pared traía una sola medida: se toma como la primera fila.
    entradas.habitaciones = limpiaHabitaciones(crudo.habitaciones)
      ?? [{ nombre: ENTRADAS_POR_DEFECTO.habitaciones[0].nombre, largoFt: entradas.largoFt, anchoFt: entradas.anchoFt }];
    entradas.muros = limpiaMuros(crudo.muros)
      ?? [{ nombre: ENTRADAS_POR_DEFECTO.muros[0].nombre, largoFt: entradas.largoFt, altoFt: entradas.altoFt, aberturasSf: entradas.aberturasSf }];
    return {
      entradas,
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
  // Las filas se revisan aparte (limpiaHabitaciones / limpiaMuros) y no pasan por aquí.
  if (k === "habitaciones" || k === "muros") return false;
  return typeof x === "number" && Number.isFinite(x);
}

const numero = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const nombre = (x: unknown, por: string): string => (typeof x === "string" ? x.slice(0, 40) : por);

/** Las habitaciones guardadas, si son una lista válida (1 a MAX fila); si no, null. */
export function limpiaHabitaciones(x: unknown): Habitacion[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_FILAS_DE_MEDIDA) return null;
  const filas: Habitacion[] = [];
  for (const f of x) {
    const o = f as Record<string, unknown>;
    const largoFt = numero(o?.largoFt), anchoFt = numero(o?.anchoFt);
    if (largoFt === null || anchoFt === null) return null;
    filas.push({ nombre: nombre(o.nombre, `Room ${filas.length + 1}`), largoFt, anchoFt });
  }
  return filas;
}

/** Los muros guardados, si son una lista válida (1 a MAX fila); si no, null. */
export function limpiaMuros(x: unknown): Muro[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_FILAS_DE_MEDIDA) return null;
  const filas: Muro[] = [];
  for (const f of x) {
    const o = f as Record<string, unknown>;
    const largoFt = numero(o?.largoFt), altoFt = numero(o?.altoFt), aberturasSf = numero(o?.aberturasSf);
    if (largoFt === null || altoFt === null || aberturasSf === null) return null;
    filas.push({ nombre: nombre(o.nombre, `Wall ${filas.length + 1}`), largoFt, altoFt, aberturasSf });
  }
  return filas;
}

export function guardar(g: Guardado): void {
  try { window.localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(g)); } catch { /* sin almacenamiento: no pasa nada */ }
}
