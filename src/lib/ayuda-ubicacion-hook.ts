"use client";
// El hook vive aparte de ayuda-ubicacion.ts porque ese módulo también lo importa el servidor (/api/help):
// un módulo con useEffect no puede entrar en una ruta de servidor (rompió el build de D-901).
import { useEffect } from "react";
import { normaliza, publicaContextoDeAyuda, retiraContextoDeAyuda, type Bilingue, type ParteDeContexto } from "@/lib/ayuda-ubicacion";

/**
 * Lo que una pantalla publica mientras está montada: su pestaña, su filtro, su ficha abierta, su paso.
 *
 *   useContextoDeAyuda("gestor", [{ en: "Unassigned tab", es: "Pestaña Sin asignar" }, fecha, abierta && `…`]);
 *
 * Lo falso se salta, así que se puede escribir con `&&`. Se vuelve a publicar solo cuando cambia lo que dice, y se
 * retira al desmontar: una pantalla que ya no está no deja su contexto pegado a la siguiente.
 */
export function useContextoDeAyuda(id: string, partes: readonly ParteDeContexto[], opciones: { encima?: boolean } = {}): void {
  const clave = JSON.stringify(normaliza(partes));
  const encima = opciones.encima === true;
  useEffect(() => { publicaContextoDeAyuda(id, JSON.parse(clave) as Bilingue[], { encima }); }, [id, clave, encima]);
  useEffect(() => () => retiraContextoDeAyuda(id), [id]);
}
