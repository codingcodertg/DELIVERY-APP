import { aLaDecima } from "./pallets";

/**
 * «¿Cuántos pallets cargas?» al pulsar «🚚 Recogido» en «Mi ruta» (D-547, 2026-10-14).
 *
 * El dueño: *«Also when they are picking up it's not asking them how many pallets are they loading drivers»*. Desde D-533
 * «Recogido» con la carga lista se hace de un toque y escribía, sin preguntar, los pallets que ya tenía la orden
 * (`palletsDeRecogida`: los confirmados por el almacén, o los estimados). Ahora un cuadro pequeño pregunta el número, con
 * ese mismo valor ya puesto: si cuadra, es un toque más («Confirmar»); si no, lo corrige.
 *
 * Dónde se guarda: en `actual_pallets`, el campo de «pallets confirmados» (el mismo que escribe el almacén con «Pallets
 * confirmed: N», y el que la recogida ya escribía). Va en la MISMA escritura que pasa la orden a `picked_up`
 * (`escrituraRecogida({ pallets })`): el guard de la base (169) deja al chofer el salto `ready → picked_up` sin mirar
 * columnas, así que no hace falta migración. Una escritura aparte, en la misma etapa, sí se la rechazaría.
 *
 * Puro: sin React. Lo pinta `PalletsAlRecoger.tsx`; lo llama `my-route/page.tsx`.
 */

/** Lo más que se acepta escribir: muy por encima de un camión (10-12), para cazar un dedazo como «100» sin estorbar. */
export const MAXIMO_PALLETS_AL_RECOGER = 99;

/** El número que el cuadro trae ya puesto: los confirmados, y si no hay, los estimados. Vacío si no hay ninguno (o 0). */
export function palletsPorDefecto(d: { actual_pallets?: number | null; est_pallets?: number | null }): string {
  const v = Number(d.actual_pallets ?? d.est_pallets ?? 0);
  return Number.isFinite(v) && v > 0 ? String(aLaDecima(v)) : "";
}

/**
 * Lo que escribió el chofer, como número de pallets, o `null` si no vale: vacío, no numérico, 0 o menos, o más del
 * máximo. Acepta coma decimal («1,5») y se queda en la décima, la unidad de la app (D-362).
 */
export function leePalletsAlRecoger(texto: string | null | undefined): number | null {
  const t = (texto ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const d = aLaDecima(n);
  return d > 0 && d <= MAXIMO_PALLETS_AL_RECOGER ? d : null;
}
