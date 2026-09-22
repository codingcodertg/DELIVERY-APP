"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import { filtraFilas, opcionesDeFiltro, ordenaFilas, type FiltrosPorColumna, type ValorDeCelda } from "@/lib/orden-y-filtro";

/**
 * El estado del orden y los filtros de UNA tabla, con el menú por columna de Órdenes (D-275) llevado a las tablas
 * del Gestor de Rutas (D-360). Es solo estado de la pantalla: al salir se pierde, a propósito — el dueño pidió
 * ordenar y filtrar, no guardar vistas; y una vista guardada que nadie recuerda es un filtro que esconde órdenes.
 *
 * `valorDe(clave, fila)` es lo que la columna `clave` extrae de una fila; debe ser estable entre renders
 * (`useCallback`), porque la lista ordenada se recalcula cuando cambia.
 */
export function useOrdenYFiltro<T>(filas: readonly T[], valorDe: (clave: string, fila: T) => ValorDeCelda) {
  const [claveDeOrden, setClaveDeOrden] = useState<string | null>(null);
  const [direccion, setDireccion] = useState<"asc" | "desc" | null>(null);
  const [filtros, setFiltros] = useState<FiltrosPorColumna>({});
  const [abierta, setAbierta] = useState<string | null>(null);
  // El menú se pinta en un portal (como en Órdenes: un `.tbl-scroll` con barra horizontal recorta lo que
  // sobresale en vertical, y el menú quedaba escondido), así que hace falta dónde está la celda en pantalla.
  const [ancla, setAncla] = useState<DOMRect | null>(null);
  const celdas = useRef(new Map<string, HTMLDivElement>());
  const menuRef = useRef<HTMLDivElement>(null);

  const abrir = (clave: string) => {
    if (abierta === clave) { setAbierta(null); return; }
    const celda = celdas.current.get(clave);
    if (celda) setAncla(celda.getBoundingClientRect());
    setAbierta(clave);
  };

  // Que el menú siga pegado a su cabecera al desplazar o cambiar el tamaño.
  useEffect(() => {
    if (!abierta) return;
    const recoloca = () => {
      const celda = celdas.current.get(abierta);
      if (celda) setAncla(celda.getBoundingClientRect());
    };
    window.addEventListener("scroll", recoloca, true);
    window.addEventListener("resize", recoloca);
    return () => {
      window.removeEventListener("scroll", recoloca, true);
      window.removeEventListener("resize", recoloca);
    };
  }, [abierta]);

  // Clic fuera o Escape lo cierran; la propia cabecera cuenta como dentro, para que pulsarla otra vez cierre.
  useCierraAlSalir(!!abierta, () => setAbierta(null), () => [menuRef.current, abierta ? celdas.current.get(abierta) : null]);

  const visibles = useMemo(() => {
    const filtradas = filtraFilas(filas, filtros, valorDe);
    return claveDeOrden ? ordenaFilas(filtradas, (f) => valorDe(claveDeOrden, f), direccion) : filtradas;
  }, [filas, filtros, claveDeOrden, direccion, valorDe]);

  const ordenar = (clave: string, dir: "asc" | "desc" | null) => {
    setClaveDeOrden(dir ? clave : null);
    setDireccion(dir);
    setAbierta(null);
  };
  const aplicar = (clave: string, marcados: Set<string>) => {
    setFiltros((f) => ({ ...f, [clave]: marcados }));
    setAbierta(null);
  };
  const limpiar = (clave: string) => {
    setFiltros((f) => { const n = { ...f }; delete n[clave]; return n; });
    setAbierta(null);
  };
  /** Las opciones del menú de `clave`: los valores que quedarían si se quitara solo ese filtro (en cascada). */
  const opciones = (clave: string, etiqueta?: (v: ValorDeCelda) => string) =>
    opcionesDeFiltro(filtraFilas(filas, filtros, valorDe, clave), (f) => valorDe(clave, f), etiqueta);

  return {
    visibles, claveDeOrden, direccion, filtros, abierta, ancla, celdas, menuRef,
    abrir, cerrar: () => setAbierta(null), ordenar, aplicar, limpiar, opciones,
    limpiarTodo: () => setFiltros({}),
  };
}

export type OrdenYFiltro<T> = ReturnType<typeof useOrdenYFiltro<T>>;
