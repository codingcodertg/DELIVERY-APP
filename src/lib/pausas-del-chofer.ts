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

/** ¿Pide recibo al seguir? Solo la gasolina. */
export const pideRecibo = (motivo: MotivoDePausa): boolean => motivo === "gas";

/**
 * Lo que se guarda al pulsar «▶ Seguir», o por qué no se puede todavía.
 *
 * La de gasolina **no se cierra sin recibo** salvo con «No tengo recibo» marcado a propósito, que se guarda (`sin_recibo`).
 * Monto y galones son opcionales, pero si se escriben tienen que ser números. Las demás se cierran sin preguntar nada: lo
 * que se escribiera de recibo en una que no es de gasolina no se guarda.
 */
export function cierreDePausa(
  motivo: MotivoDePausa,
  entrada: { foto: string | null; monto: string; galones: string; sinRecibo: boolean },
): CierreDePausa | { falta: "recibo" | "monto" | "galones" } {
  if (!pideRecibo(motivo)) return { recibo_foto: null, recibo_monto: null, recibo_galones: null, sin_recibo: false };
  const monto = numeroOpcional(entrada.monto);
  const galones = numeroOpcional(entrada.galones);
  if (Number.isNaN(monto)) return { falta: "monto" };
  if (Number.isNaN(galones)) return { falta: "galones" };
  if (entrada.foto) return { recibo_foto: entrada.foto, recibo_monto: monto, recibo_galones: galones, sin_recibo: false };
  if (entrada.sinRecibo) return { recibo_foto: null, recibo_monto: monto, recibo_galones: galones, sin_recibo: true };
  return { falta: "recibo" };
}

/** La pausa abierta del chofer (la más nueva sin terminar), o `null`. La base solo deja una abierta por chofer. */
export function pausaAbierta(pausas: readonly PausaDelChofer[]): PausaDelChofer | null {
  return [...pausas].filter((p) => !p.termino_at).sort((a, b) => b.empezo_at.localeCompare(a.empezo_at))[0] ?? null;
}

/** La hora de cierre: ahora, pero nunca antes del inicio (un reloj de teléfono atrasado no rompe la regla de la base). */
export function horaDeCierre(empezo: string, ahora: Date = new Date()): string {
  return new Date(Math.max(ahora.getTime(), Date.parse(empezo))).toISOString();
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
