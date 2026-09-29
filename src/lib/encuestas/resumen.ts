/**
 * Lo que calcula la app «Encuestas» (/surveys) a partir de las filas de `survey_responses` (migración 155).
 *
 * Todo puro, sin red ni base: la pantalla lee las filas con la sesión de quien mira (la RLS de la 155 decide
 * si ve algo) y le pasa el resultado a estas funciones. El día de cada respuesta es el de Texas
 * (`isoInTZ`, America/Chicago), no el UTC: una respuesta de las 9 de la noche es de ese día, no del siguiente.
 */
import { BUSINESS_TZ, isoInTZ, shiftDateISO } from "@/lib/utils";
import { AREA_KEYS, AREA_LABELS, NADA_LABEL, type AreaKey } from "./areas";

export interface RespuestaEncuesta {
  id: string;
  created_at: string;
  nothing_to_improve: boolean;
  selected_areas: string[];
  other_text: string | null;
  ratings: Record<string, number>;
  wants_contact: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contacted: boolean;
  contacted_at: string | null;
}

/** Las columnas que se leen, en el orden de la tabla. Una sola lista para la pantalla y la prueba. */
export const COLUMNAS =
  "id, created_at, nothing_to_improve, selected_areas, other_text, ratings, wants_contact, contact_name, contact_phone, contact_email, contacted, contacted_at";

/** El día de Texas (YYYY-MM-DD) de una respuesta. */
export const diaDe = (iso: string): string => isoInTZ(new Date(iso));

/** Las respuestas cuyo día cae entre `desde` y `hasta`, las dos incluidas. Un extremo vacío no limita. */
export function filtrarPorFechas(filas: RespuestaEncuesta[], desde: string | null, hasta: string | null): RespuestaEncuesta[] {
  return filas.filter((f) => {
    const d = diaDe(f.created_at);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    return true;
  });
}

/** Tope de días que se dibujan en la serie: un rango de años sin filtro no debe pintar miles de barras. */
export const MAX_DIAS_SERIE = 366;

/**
 * Respuestas por día, con los días sin respuestas en CERO (un hueco en la serie se leería como «no hay dato»).
 * El rango es el del filtro; si falta un extremo, el de las propias filas. Si pasa de `MAX_DIAS_SERIE`, se
 * quedan los últimos.
 */
export function respuestasPorDia(
  filas: RespuestaEncuesta[],
  desde: string | null,
  hasta: string | null,
): { dia: string; n: number }[] {
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    const d = diaDe(f.created_at);
    cuenta.set(d, (cuenta.get(d) ?? 0) + 1);
  }
  const dias = [...cuenta.keys()].sort();
  const ini = desde ?? dias[0];
  const fin = hasta ?? dias[dias.length - 1];
  if (!ini || !fin || ini > fin) return [];
  const serie: { dia: string; n: number }[] = [];
  for (let d = ini; d <= fin; d = shiftDateISO(d, 1)) {
    serie.push({ dia: d, n: cuenta.get(d) ?? 0 });
  }
  return serie.length > MAX_DIAS_SERIE ? serie.slice(serie.length - MAX_DIAS_SERIE) : serie;
}

export interface ResumenDeArea {
  key: AreaKey;
  /** Cuántas respuestas la marcaron. */
  veces: number;
  /** La media de sus calificaciones, o null si nadie la calificó. */
  media: number | null;
}

/** Por cada una de las ocho áreas, en el orden de la encuesta: cuántas veces se eligió y su calificación media. */
export function porArea(filas: RespuestaEncuesta[]): ResumenDeArea[] {
  return AREA_KEYS.map((key) => {
    let veces = 0;
    let suma = 0;
    let calificadas = 0;
    for (const f of filas) {
      if (!f.selected_areas.includes(key)) continue;
      veces++;
      const r = f.ratings?.[key];
      if (typeof r === "number" && Number.isFinite(r)) {
        suma += r;
        calificadas++;
      }
    }
    return { key, veces, media: calificadas ? suma / calificadas : null };
  });
}

/** El % de respuestas que eligieron «Nada, todo estuvo bien». null sin respuestas (0 % sería mentir). */
export function porcentajeNada(filas: RespuestaEncuesta[]): number | null {
  if (!filas.length) return null;
  return (filas.filter((f) => f.nothing_to_improve).length / filas.length) * 100;
}

/** Los textos de «Other», del más reciente al más antiguo, con su calificación. */
export function textosOther(filas: RespuestaEncuesta[]): { id: string; created_at: string; texto: string; calificacion: number | null }[] {
  return filas
    .filter((f) => f.selected_areas.includes("other") && !!f.other_text?.trim())
    .map((f) => ({ id: f.id, created_at: f.created_at, texto: f.other_text!.trim(), calificacion: f.ratings?.other ?? null }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/** Quienes pidieron que los contacten: primero los que faltan por contactar, y dentro de cada grupo lo más reciente arriba. */
export function paraContactar(filas: RespuestaEncuesta[]): RespuestaEncuesta[] {
  return filas
    .filter((f) => f.wants_contact)
    .sort((a, b) => {
      if (a.contacted !== b.contacted) return a.contacted ? 1 : -1;
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
    });
}

/** «Atención del personal 4 · Otro 2», o «Nada, todo estuvo bien». Lo que eligió una persona y cómo lo calificó. */
export function eleccionesDe(f: RespuestaEncuesta, lang: "en" | "es"): string {
  if (f.nothing_to_improve) return NADA_LABEL[lang];
  return f.selected_areas
    .map((k) => {
      const nombre = k in AREA_LABELS ? AREA_LABELS[k as AreaKey][lang] : k;
      const r = f.ratings?.[k];
      return typeof r === "number" ? `${nombre} ${r}` : nombre;
    })
    .join(" · ");
}

/** La hora de Texas de un instante, «YYYY-MM-DD HH:MM», para la tabla y el CSV. */
export function fechaHora(iso: string): string {
  const d = new Date(iso);
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${isoInTZ(d)} ${hora}`;
}

/**
 * La tabla del CSV: una fila por respuesta y una columna de calificación por área, para que se pueda filtrar
 * y promediar en una hoja de cálculo sin partir texto. Las cabeceras en inglés (como el CSV de Entregas) con la
 * clave estable del área.
 */
export function tablaCsv(filas: RespuestaEncuesta[]): { cabeceras: string[]; filas: (string | number | null)[][] } {
  const cabeceras = [
    "id", "created_at (Central)", "nothing_to_improve", "selected_areas",
    ...AREA_KEYS.map((k) => `rating_${k}`),
    "other_text", "wants_contact", "contact_name", "contact_phone", "contact_email", "contacted", "contacted_at (Central)",
  ];
  const cuerpo = filas.map((f) => [
    f.id,
    fechaHora(f.created_at),
    f.nothing_to_improve ? "yes" : "no",
    f.selected_areas.join(" "),
    ...AREA_KEYS.map((k) => (typeof f.ratings?.[k] === "number" ? f.ratings[k] : null)),
    f.other_text,
    f.wants_contact ? "yes" : "no",
    f.contact_name,
    f.contact_phone,
    f.contact_email,
    f.contacted ? "yes" : "no",
    f.contacted_at ? fechaHora(f.contacted_at) : null,
  ]);
  return { cabeceras, filas: cuerpo };
}
