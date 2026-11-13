/**
 * «⏸ Registrar parada»: el chofer anota que se detiene por algo que NO es una orden —baño, gasolina, comida, tráfico— y
 * cuándo sigue (D-520). El dueño, 2026-10-11: *«AGREGA A BUTTOM TO LOG A STOP PUEDE SER RESTROOM, STOP FOR GAS Y ASI»* y
 * *«AND WHEN STOPPED FOR GAS ASK TO UPLOAD DE GAS RECEIPT»*.
 *
 * Se llama «pausa» en el código para no confundirla con las paradas de la ruta (`paradasDeLaRuta`, `paradasDelChofer`), que
 * son de órdenes. En pantalla dice «parada», que es como habla el chofer.
 *
 * Vive en su tabla, `public.pausas_del_chofer` (migración 167): no es un evento de una orden, y nada de lo que había servía
 * —`driver_shifts` es el turno entero, `driver_incidents` lo escribe logística y es de costos, `driver_locations` es un
 * punto sin motivo, y las paradas de «Voy a salir» (`clockin.trip_stops`, D-455) son del Time Tracker y piden un viaje
 * abierto—. Hasta que la 167 se aplique, la pantalla lo dice y no se rompe (`faltaLaTabla`).
 *
 * Puro: sin React, sin red. Lo que escribe y lee está en `usePausasDelChofer`.
 */
import { centralShiftMs, centralWallToUtc } from "@/lib/clockin/tz";

export const MOTIVOS_DE_PAUSA = [
  { clave: "restroom", icono: "🚻", en: "Restroom", es: "Baño" },
  { clave: "gas", icono: "⛽", en: "Gas", es: "Gasolina" },
  { clave: "food", icono: "🍔", en: "Food", es: "Comida" },
  { clave: "traffic", icono: "🚦", en: "Traffic or waiting", es: "Tráfico o espera" },
  { clave: "other", icono: "📝", en: "Other", es: "Otro" },
] as const;

export type MotivoDePausa = (typeof MOTIVOS_DE_PAUSA)[number]["clave"];
/**
 * Los que el chofer puede ELEGIR (D-541). El dueño, 2026-10-13: *«from stops in driver dtop buttom will be jsut gas,
 * restroom, food and other and for other add the note»*. Fuera «Tráfico o espera»; «Otro» ya pedía la nota. La lista
 * entera sigue arriba porque las paradas ya guardadas con `traffic` tienen que seguir leyéndose con su nombre.
 */
//
// **Reemplazado en parte por D-547** (2026-10-14): fuera también «Baño». El dueño: *«Maybe they don't need to log restroom
// breaks 😆 that might be too much»*. Quedan Gasolina, Comida y Otro (con su nota). `restroom` sigue en `MOTIVOS_DE_PAUSA`
// para que las paradas ya guardadas con él se lean con su nombre (y la base, 167, lo sigue admitiendo).
export const MOTIVOS_PARA_ELEGIR = (["gas", "food", "other"] as const)
  .map((clave) => MOTIVOS_DE_PAUSA.find((m) => m.clave === clave)!);

/** «Otro» obliga a decir qué: tres letras como mínimo, la misma vara que la razón de un rechazo (D-487). */
export const MINIMO_TEXTO_OTRO = 3;
/** Lo más largo que se guarda de una nota (la base tiene el mismo tope). */
export const MAXIMO_NOTA = 500;

/**
 * Una parada abierta más de esto (o que empezó otro día del negocio) es «vieja»: se cierra sola al empezar otra o al
 * seguir, a su hora de cierre (`horaDeCierreDeVieja`), nunca a «ahora» días después. El dueño no ha fijado el número; 3 h
 * cubre una parada de gasolina o comida, y más de eso ya no es una parada. Si se cambia, cambia solo aquí.
 */
export const TOPE_DE_PARADA_ABIERTA_MS = 3 * 60 * 60 * 1000;

export interface PausaDelChofer {
  id: string;
  driver_id: string;
  motivo: MotivoDePausa;
  nota: string | null;
  empezo_at: string;
  /** `null`: el chofer sigue parado. */
  termino_at: string | null;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  /** La foto del recibo, como las fotos de una entrega: una imagen JPEG comprimida en el teléfono (`data:image/jpeg…`). */
  recibo_foto: string | null;
  recibo_monto: number | null;
  recibo_galones: number | null;
  /** «No tengo recibo», dicho a propósito al cerrar una de gasolina. */
  sin_recibo: boolean;
  created_at: string;
}

const esMotivo = (x: string | null | undefined): x is MotivoDePausa => MOTIVOS_DE_PAUSA.some((m) => m.clave === x);

/** Lo que se guarda al empezar, o `null` si falta algo: sin motivo, u «Otro» sin texto. La nota se limpia de espacios. */
export function inicioDePausa(motivo: string | null | undefined, texto: string | null | undefined): { motivo: MotivoDePausa; nota: string | null } | null {
  if (!esMotivo(motivo) || !MOTIVOS_PARA_ELEGIR.some((m) => m.clave === motivo)) return null;
  const nota = (texto ?? "").trim().replace(/\s+/g, " ").slice(0, MAXIMO_NOTA);
  if (motivo === "other" && nota.length < MINIMO_TEXTO_OTRO) return null;
  return { motivo, nota: nota || null };
}

/** Un número que el chofer puede dejar vacío. `null` vacío; `NaN` si escribió algo que no es un número ≥ 0. Acepta coma. */
export function numeroOpcional(texto: string | null | undefined): number | null {
  const t = (texto ?? "").trim().replace(/^\$/, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

export interface CierreDePausa {
  recibo_foto: string | null;
  recibo_monto: number | null;
  recibo_galones: number | null;
  sin_recibo: boolean;
}

/** ¿Pide recibo? Solo la gasolina. */
export const pideRecibo = (motivo: MotivoDePausa): boolean => motivo === "gas";

/**
 * Lo que se guarda al pulsar «▶ Seguir», o por qué no se puede todavía (monto o galones escritos mal).
 *
 * Cambio del 2026-11-13 (resumen del pedido, no es cita). Por eso la gasolina ya **no exige el recibo para cerrar**: sin foto y sin «No tengo
 * recibo», la parada se cierra con el recibo PENDIENTE (`recibo_foto` null, `sin_recibo` false), y aparece en «Recibos
 * pendientes» para subirlo después. «No tengo recibo» sigue siendo una respuesta a propósito y queda anotada.
 * Las demás se cierran sin preguntar nada: lo que se escribiera de recibo en una que no es de gasolina no se guarda.
 */
export function cierreDePausa(
  motivo: MotivoDePausa,
  entrada: { foto: string | null; monto: string; galones: string; sinRecibo: boolean },
): CierreDePausa | { falta: "monto" | "galones" } {
  if (!pideRecibo(motivo)) return { recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false };
  const monto = numeroOpcional(entrada.monto);
  const galones = numeroOpcional(entrada.galones);
  if (Number.isNaN(monto)) return { falta: "monto" };
  if (Number.isNaN(galones)) return { falta: "galones" };
  if (entrada.foto) return { recibo_foto: entrada.foto, recibo_monto: monto, recibo_galones: galones, sin_recibo: false };
  return { recibo_foto: null, recibo_monto: monto, recibo_galones: galones, sin_recibo: !!entrada.sinRecibo };
}

/** Lo que se guarda al subir el recibo de una parada que ya está registrada (2026-11-13). Solo recibo: nada de horas ni lugar. */
export function reciboTardio(
  entrada: { foto: string | null; monto: string; galones: string },
): { recibo_foto: string; recibo_monto: number | null; recibo_galones: number | null } | { falta: "foto" | "monto" | "galones" } {
  const monto = numeroOpcional(entrada.monto);
  const galones = numeroOpcional(entrada.galones);
  if (Number.isNaN(monto)) return { falta: "monto" };
  if (Number.isNaN(galones)) return { falta: "galones" };
  if (!entrada.foto) return { falta: "foto" };
  return { recibo_foto: entrada.foto, recibo_monto: monto, recibo_galones: galones };
}

/** Le falta el recibo: es de gasolina, sin foto, y nadie dijo «no tengo». Abierta o cerrada. */
export const sinReciboTodavia = (p: Pick<PausaDelChofer, "motivo" | "recibo_foto" | "sin_recibo">): boolean =>
  pideRecibo(p.motivo) && !p.recibo_foto && !p.sin_recibo;

/** Las de un día que aún no tienen recibo, de la más vieja a la más nueva (2026-11-13). */
export function recibosPendientes(pausas: readonly PausaDelChofer[]): PausaDelChofer[] {
  return pausas.filter(sinReciboTodavia).sort((a, b) => a.empezo_at.localeCompare(b.empezo_at));
}

/** La pausa abierta del chofer (la más nueva sin terminar), o `null`. La base solo deja una abierta por chofer. */
export function pausaAbierta(pausas: readonly PausaDelChofer[]): PausaDelChofer | null {
  return [...pausas].filter((p) => !p.termino_at).sort((a, b) => b.empezo_at.localeCompare(a.empezo_at))[0] ?? null;
}

/** La hora de cierre: ahora, pero nunca antes del inicio (un reloj de teléfono atrasado no rompe la regla de la base). */
export function horaDeCierre(empezo: string, ahora: Date = new Date()): string {
  return new Date(Math.max(ahora.getTime(), Date.parse(empezo))).toISOString();
}

/** El día del negocio (America/Chicago, AAAA-MM-DD) en que cae un instante. */
export function diaDelNegocio(iso: string): string {
  const t = Date.parse(iso);
  return new Date(t - centralShiftMs(new Date(t))).toISOString().slice(0, 10);
}

/** La medianoche (Central) que cierra el día del negocio en que empezó la parada. */
export function finDelDiaDe(empezo: string): string {
  const siguiente = new Date(Date.parse(`${diaDelNegocio(empezo)}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return centralWallToUtc(`${siguiente}T00:00`);
}

/**
 * ¿Es vieja? Abierta, y o empezó en otro día del negocio, o lleva más de `TOPE_DE_PARADA_ABIERTA_MS`. Una parada cerrada
 * nunca es vieja.
 */
export function esParadaVieja(p: Pick<PausaDelChofer, "empezo_at" | "termino_at">, ahora: Date = new Date()): boolean {
  if (p.termino_at) return false;
  return diaDelNegocio(p.empezo_at) < diaDelNegocio(ahora.toISOString()) || ahora.getTime() - Date.parse(p.empezo_at) > TOPE_DE_PARADA_ABIERTA_MS;
}

/**
 * La hora con la que se cierra una parada VIEJA (2026-11-13): su inicio más el tope, o la medianoche que cierra su día si esa
 * llega antes; nunca antes del inicio. Así una parada de la noche anterior queda con una duración razonable, no con los
 * días que pasaron hasta que el chofer abrió la app.
 */
export function horaDeCierreDeVieja(empezo: string): string {
  const inicio = Date.parse(empezo);
  const fin = Math.min(inicio + TOPE_DE_PARADA_ABIERTA_MS, Date.parse(finDelDiaDe(empezo)));
  return new Date(Math.max(inicio, fin)).toISOString();
}

/** La hora con la que se cierra una parada al pulsar «▶ Seguir»: la regla de vieja si lo es, si no, ahora. */
export function horaDeCierreDe(p: Pick<PausaDelChofer, "empezo_at" | "termino_at">, ahora: Date = new Date()): string {
  return esParadaVieja(p, ahora) ? horaDeCierreDeVieja(p.empezo_at) : horaDeCierre(p.empezo_at, ahora);
}

export function nombreDelMotivo(motivo: MotivoDePausa, lang: "en" | "es"): string {
  const m = MOTIVOS_DE_PAUSA.find((x) => x.clave === motivo);
  return m ? `${m.icono} ${lang === "es" ? m.es : m.en}` : motivo;
}

/** Minutos enteros entre el inicio y el fin (o ahora, si sigue parado). */
export function minutosDePausa(p: Pick<PausaDelChofer, "empezo_at" | "termino_at">, ahora: Date = new Date()): number {
  const fin = p.termino_at ? Date.parse(p.termino_at) : ahora.getTime();
  return Math.max(0, Math.round((fin - Date.parse(p.empezo_at)) / 60_000));
}

/** «⏸ En parada: ⛽ Gasolina · 10:42» / «⏸ Stopped: ⛽ Gas · 10:42». `hora` formatea la hora como la pantalla quiera. */
export function textoDePausaAbierta(p: Pick<PausaDelChofer, "motivo" | "empezo_at">, lang: "en" | "es", hora: (iso: string) => string): string {
  return `⏸ ${lang === "es" ? "En parada" : "Stopped"}: ${nombreDelMotivo(p.motivo, lang)} · ${hora(p.empezo_at)}`;
}

// ---- El demo y el modo enseñanza: sin base, en este navegador ---------------------------------------------------------

export const LS_PAUSAS = "rtg_driver_pauses_local_v1";

type Almacen = Pick<Storage, "getItem" | "setItem">;

export function leePausasLocales(almacen: Almacen | null | undefined): PausaDelChofer[] {
  try {
    const crudo = almacen?.getItem(LS_PAUSAS);
    const v = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function guardaPausasLocales(almacen: Almacen | null | undefined, filas: readonly PausaDelChofer[]): boolean {
  try { almacen?.setItem(LS_PAUSAS, JSON.stringify(filas)); return !!almacen; } catch { return false; }
}
