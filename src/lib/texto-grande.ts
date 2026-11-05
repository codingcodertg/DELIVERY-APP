"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * «Texto grande» del chofer (D-NEXT). El dueño, con la solicitud de Ernesto («This is too small, didnt even see it», la
 * casilla «Entregué en otra dirección»): «los choferes son señores mayores, necesitan vistas más grandes».
 *
 * Encendido POR DEFECTO para el rol `driver` (y en la columna de teléfono de la pestaña «Chofer» del admin, que enseña la
 * ruta como la ve el chofer). Cada persona lo puede apagar con «Texto grande» en Mi ruta; se guarda en este navegador, con
 * su id en la clave. Lo que agranda vive en `src/app/(app)/texto-grande.css`, colgado de `[data-texto-grande="on"]`: la
 * oficina (Entregas compacta, D-855) no lo ve nunca.
 */
export const ATRIBUTO_TEXTO_GRANDE = "data-texto-grande";
export const claveTextoGrande = (userId: string) => `rtg_texto_grande:${userId}`;

/** Lo guardado manda; sin nada guardado, encendido. «0» es apagado; cualquier otra cosa, encendido. */
export function leeTextoGrande(get: (k: string) => string | null, userId: string): boolean {
  try { return get(claveTextoGrande(userId)) !== "0"; } catch { return true; }
}

const EVENTO = "rtg-texto-grande";
const suscribe = (avisa: () => void) => {
  window.addEventListener(EVENTO, avisa);
  window.addEventListener("storage", avisa);
  return () => { window.removeEventListener(EVENTO, avisa); window.removeEventListener("storage", avisa); };
};

/** [encendido, cambiar]. En el servidor (sin `localStorage`) cuenta como encendido, que es el valor por defecto. */
export function useTextoGrande(userId: string | null | undefined): [boolean, (on: boolean) => void] {
  const id = userId ?? "";
  const on = useSyncExternalStore(
    suscribe,
    () => leeTextoGrande((k) => window.localStorage.getItem(k), id),
    () => true,
  );
  const cambia = useCallback((v: boolean) => {
    try { window.localStorage.setItem(claveTextoGrande(id), v ? "1" : "0"); } catch { /* sin almacenamiento: dura la sesión */ }
    window.dispatchEvent(new Event(EVENTO));
  }, [id]);
  return [on, cambia];
}
