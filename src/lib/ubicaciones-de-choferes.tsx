"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { DriverLocation } from "@/lib/types";

// ============================================================
// Dónde está cada chofer AHORA (una fila por chofer), fuera del contexto principal.
//
// Antes vivía en el estado de `DataProvider`: cada ping de GPS (cada ~5 s por chofer) repintaba a los ~100
// consumidores de `useData()`. Ahora es un almacén aparte: solo re-renderiza quien llama a
// `useUbicacionesDeChoferes()`, y solo está suscrito a realtime y a la consulta inicial mientras haya alguien
// que lo use (contador de usos).
// ============================================================

/** De dónde salen las posiciones: la consulta inicial y el canal de realtime. `null` = sin fuente (demo local). */
export interface FuenteDeUbicaciones {
  /** Las posiciones más recientes (la primera de cada chofer). `null` si la consulta falló: no se toca nada. */
  cargar: () => Promise<DriverLocation[] | null>;
  /** Avisa de cada fila nueva que llegue. Devuelve cómo dejar de escuchar. */
  escuchar: (alLlegar: (fila: DriverLocation) => void) => () => void;
}

/**
 * Aplica una posición a la lista (una por chofer, la más reciente primero). Una fila más vieja que la que ya
 * está no pisa a la nueva: los datos del teléfono llegan a destiempo tras una zona sin señal. Devuelve la
 * MISMA lista si no cambia nada, para no avisar a nadie de balde.
 */
export function aplicarPosicion(lista: readonly DriverLocation[], fila: DriverLocation): DriverLocation[] {
  const actual = lista.find((p) => p.driver_id === fila.driver_id);
  if (actual && actual.recorded_at > fila.recorded_at) return lista as DriverLocation[];
  return [fila, ...lista.filter((p) => p.driver_id !== fila.driver_id)];
}

/**
 * De filas ya ordenadas de la más nueva a la más vieja (como sale de la consulta), se queda con la primera de
 * cada chofer: su posición actual. Lo demás es rastro que no se guarda en memoria.
 */
export function ultimasPorChofer(filas: readonly DriverLocation[]): DriverLocation[] {
  const vistos = new Map<string, DriverLocation>();
  for (const fila of filas) if (!vistos.has(fila.driver_id)) vistos.set(fila.driver_id, fila);
  return [...vistos.values()];
}

/** Une dos listas, dejando la más reciente de cada chofer. `extra` manda sobre `base` solo si es más nueva. */
function fusionar(base: readonly DriverLocation[], extra: readonly DriverLocation[]): DriverLocation[] {
  let out = [...base];
  for (const fila of [...extra].reverse()) out = aplicarPosicion(out, fila);
  return out;
}

const VACIA: DriverLocation[] = [];

export interface AlmacenDeUbicaciones {
  /** La lista actual (referencia estable mientras no cambie). */
  leer: () => DriverLocation[];
  /** Para `useSyncExternalStore`: avisa cuando la lista cambia. */
  suscribir: (cambio: () => void) => () => void;
  /** Pone una posición nueva (la propia del teléfono, o la que llega por realtime). */
  aplicar: (fila: DriverLocation) => void;
  /** Cambia la fuente (null = ninguna). Si hay alguien mirando, se reengancha con la nueva. */
  fijarFuente: (fuente: FuenteDeUbicaciones | null) => void;
  /**
   * Pide las posiciones (contador de usos). La primera petición arranca la consulta y el canal; la última que
   * se suelta lo para y vacía la lista. Devuelve cómo soltar la petición.
   */
  pedir: () => () => void;
}

export function crearAlmacenDeUbicaciones(): AlmacenDeUbicaciones {
  let lista: DriverLocation[] = VACIA;
  let fuente: FuenteDeUbicaciones | null = null;
  let usos = 0;
  // Cada arranque lleva su número: la consulta de un arranque viejo, si llega tarde, no pisa al nuevo.
  let generacion = 0;
  let dejarDeEscuchar: (() => void) | null = null;
  const oyentes = new Set<() => void>();

  const avisar = () => { for (const o of oyentes) o(); };
  const poner = (nueva: DriverLocation[]) => {
    if (nueva === lista) return;
    lista = nueva;
    avisar();
  };

  const arrancar = () => {
    const f = fuente;
    if (!f) return;
    const gen = ++generacion;
    dejarDeEscuchar = f.escuchar((fila) => { if (gen === generacion) poner(aplicarPosicion(lista, fila)); });
    void f.cargar().then((filas) => {
      if (gen !== generacion || !filas) return;
      poner(fusionar(ultimasPorChofer(filas), lista));
    }).catch(() => { /* sin datos: la pantalla sigue como estaba, el próximo ping llega solo */ });
  };

  const parar = () => {
    generacion++;
    dejarDeEscuchar?.();
    dejarDeEscuchar = null;
    if (fuente) poner(VACIA);
  };

  return {
    leer: () => lista,
    suscribir: (cambio) => {
      oyentes.add(cambio);
      return () => { oyentes.delete(cambio); };
    },
    aplicar: (fila) => poner(aplicarPosicion(lista, fila)),
    fijarFuente: (nueva) => {
      if (nueva === fuente) return;
      const mirando = usos > 0;
      if (mirando) parar();
      fuente = nueva;
      if (mirando) arrancar();
    },
    pedir: () => {
      usos++;
      if (usos === 1) arrancar();
      let soltada = false;
      return () => {
        if (soltada) return;
        soltada = true;
        usos--;
        if (usos === 0) parar();
      };
    },
  };
}

/** El almacén del proveedor de datos. Lo monta `DataProvider` (y el demo local). */
export const UbicacionesDeChoferesCtx = createContext<AlmacenDeUbicaciones | null>(null);

/**
 * Las posiciones de los choferes. Mientras al menos un componente lo use, el almacén escucha realtime y carga
 * la consulta inicial; cuando nadie lo usa, deja de hacerlo. `activo: false` no pide nada (la lista llega vacía).
 */
export function useUbicacionesDeChoferes(opciones?: { activo?: boolean }): DriverLocation[] {
  const almacen = useContext(UbicacionesDeChoferesCtx);
  if (!almacen) throw new Error("useUbicacionesDeChoferes must be used within DataProvider");
  const activo = opciones?.activo ?? true;
  useEffect(() => {
    if (!activo) return;
    return almacen.pedir();
  }, [almacen, activo]);
  return useSyncExternalStore(almacen.suscribir, almacen.leer, almacen.leer);
}
