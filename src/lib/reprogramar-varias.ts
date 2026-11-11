/**
 * «📅 Reprogramar» VARIAS a la vez desde el Gestor de Rutas (D-994). Roberto, 2026-11-11 (Gestor → Rutas): «Would like to be
 * able to reschedule multiple at a time». El 📅 de cada fila (D-500) hacía una por una. Ahora, con varias marcadas, una sola
 * fecha nueva (o «Fecha pendiente», D-972) para todas; las que no se pueden se saltan y se dice por qué.
 *
 * La regla de quién puede es la MISMA de una sola (`puedeReprogramar`): entregada o anulada no; lo demás según el rol.
 */
import { puedeReprogramar } from "./reprogramar-orden";

export interface ParaReprogramar {
  id: string;
  stage: string;
  delivery_date?: string | null;
}

export type MotivoDeNoReprogramar = "etapa" | "misma_fecha";

/** Cuáles de las marcadas se reprograman a `fecha` (`null` = «Fecha pendiente», sin día) y cuáles se saltan, con su motivo. */
export function separaParaReprogramar<T extends ParaReprogramar>(
  marcadas: readonly T[], fecha: string | null, rol: string | null | undefined, esSuya: (d: T) => boolean = () => false,
): { pueden: T[]; saltadas: { d: T; motivo: MotivoDeNoReprogramar }[] } {
  const pueden: T[] = [];
  const saltadas: { d: T; motivo: MotivoDeNoReprogramar }[] = [];
  for (const d of marcadas) {
    if (!puedeReprogramar(rol, d.stage, esSuya(d))) saltadas.push({ d, motivo: "etapa" });
    else if ((d.delivery_date || null) === fecha) saltadas.push({ d, motivo: "misma_fecha" });
    else pueden.push(d);
  }
  return { pueden, saltadas };
}

/** El aviso al terminar: cuántas se movieron, cuántas fallaron y cuántas se saltaron (y por qué). */
export function resumenDeReprogramarVarias(
  n: { movidas: number; fallidas: number; porEtapa: number; mismaFecha: number }, destino: string | null,
): { en: string; es: string } {
  const a = destino ? { en: `to ${destino}`, es: `al ${destino}` } : { en: "to Pending Delivery Date", es: "a Fecha pendiente" };
  const en = [`Rescheduled ${n.movidas} ${a.en}.`];
  const es = [`Reprogramadas ${n.movidas} ${a.es}.`];
  if (n.fallidas) { en.push(`${n.fallidas} could not be saved.`); es.push(`${n.fallidas} no se pudieron guardar.`); }
  if (n.porEtapa) { en.push(`${n.porEtapa} skipped (delivered, canceled or not allowed for your role).`); es.push(`${n.porEtapa} saltadas (entregadas, anuladas o no permitidas para su rol).`); }
  if (n.mismaFecha) { en.push(`${n.mismaFecha} already had that date.`); es.push(`${n.mismaFecha} ya tenían esa fecha.`); }
  return { en: en.join(" "), es: es.join(" ") };
}
