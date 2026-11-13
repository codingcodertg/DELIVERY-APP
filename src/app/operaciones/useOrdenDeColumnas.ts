"use client";

import { useEffect, useState, type DragEvent } from "react";

/** Lo guardado, limpio: sin claves que ya no existen ni repetidas, y con las nuevas al final. Regla pura (probada). */
export function ordenLimpio(guardado: unknown, claves: readonly string[]): string[] {
  const lista = Array.isArray(guardado) ? guardado.filter((k): k is string => typeof k === "string") : [];
  const orden = lista.filter((k, i) => claves.includes(k) && lista.indexOf(k) === i);
  for (const k of claves) if (!orden.includes(k)) orden.push(k);
  return orden;
}

/** Soltar `desde` sobre `sobre`: queda en el lugar de `sobre` (igual que en la tabla de merma y en Órdenes). */
export function sueltaEnOrden(orden: readonly string[], desde: string, sobre: string): string[] {
  const i = orden.indexOf(desde), j = orden.indexOf(sobre);
  if (desde === sobre || i < 0 || j < 0) return [...orden];
  const sin = orden.filter((k) => k !== desde);
  sin.splice(sin.indexOf(sobre) + (i < j ? 1 : 0), 0, desde);
  return sin;
}

/**
 * Columnas que se ARRASTRAN por la cabecera (reunión 12 nov: «igual en todas las tablas, como en Órdenes»). El orden se
 * guarda por persona en este navegador. Para tablas simples; la de merma tiene además mostrar/ocultar (`columnas-de-merma`).
 */
export function useOrdenDeColumnas(clave: string, claves: readonly string[]) {
  const firma = claves.join("|");
  const [orden, setOrden] = useState<string[]>([...claves]);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  useEffect(() => {
    let guardado: unknown = null;
    try { const v = localStorage.getItem(clave); guardado = v ? JSON.parse(v) : null; } catch { /* sin almacenamiento */ }
    setOrden(ordenLimpio(guardado, firma.split("|")));
  }, [clave, firma]);
  const guarda = (n: string[]) => {
    setOrden(n);
    try { localStorage.setItem(clave, JSON.stringify(n)); } catch { /* dura hasta recargar */ }
  };
  return {
    orden,
    clase: (k: string) => "ops-cabecera-arrastrable" + (arrastrando === k ? " ops-cabecera-arrastrando" : ""),
    arrastre: (k: string) => ({
      draggable: true,
      onDragStart: (e: DragEvent) => { setArrastrando(k); e.dataTransfer.setData("text/plain", k); e.dataTransfer.effectAllowed = "move"; },
      onDragOver: (e: DragEvent) => { if (arrastrando) e.preventDefault(); },
      onDrop: (e: DragEvent) => { e.preventDefault(); if (arrastrando) guarda(sueltaEnOrden(orden, arrastrando, k)); setArrastrando(null); },
      onDragEnd: () => setArrastrando(null),
    }),
  };
}
