/* ---- Un solo reloj para RR. HH.: la hora de Brownsville, Texas (D-632, 2026-10-21) ----
 *
 * El dueño (2026-10-21): «La hora que se está enseñando en el app de mi jefe, ellos me dan una hora adelantada y yo
 * estoy en otro horario … a él le salen a las 4:30, pero yo lo puse para las 3:30 … el horario que yo ponga ahí, que ese
 * se quede, no lo adaptes al horario de cada quien … que se registren en el horario de mi jefe, que es una hora
 * adelantado porque están en Brownsville, Texas. Pongan ese horario y si hay daylight saving time, pues actualice».
 *
 * Medido antes de tocar: `phone_date` e `inperson_date` son `timestamptz` (056, la única migración que las toca). El
 * fallo no estaba en la base sino en el navegador: el `<input type="datetime-local">` se leía con `new Date(valor)` —que
 * lo interpreta en la zona DEL APARATO— y se pintaba con `toLocaleString` sin zona —otra vez la del aparato—. El
 * reclutador está una hora por detrás de Texas: escribía 3:30, se guardaba 21:30Z, y el jefe en Texas veía 4:30 (las 24
 * notas «In person / Scheduled» de producción, de julio a octubre, llevan la hora del aparato una hora por debajo de la
 * guardada en Texas).
 *
 * Aquí vive TODO lo que en RR. HH. pasa de un instante a una hora de reloj o al revés, y siempre en la zona IANA
 * `America/Chicago` (Brownsville está en hora central; el cambio de horario lo pone la zona, nunca un desfase fijo).
 * Es la única puerta a `Intl`/`toLocale*` del módulo: `hora-de-brownsville.test.ts` barre el resto y falla si alguien
 * vuelve a formatear con la zona del aparato.
 *
 * Los dos momentos raros del año (los resuelve `instanteDePared`, igual que `Temporal` con `"compatible"`):
 * - La hora que se repite (primer domingo de noviembre, 1:00–1:59): se toma la PRIMERA vez, aún en horario de verano.
 * - La hora que no existe (segundo domingo de marzo, 2:00–2:59): se corre hacia delante, 2:30 → 3:30 de verano.
 */

/** La zona de RR. HH. Es la misma que `BUSINESS_TZ` de `src/lib/utils.ts` (la prueba lo comprueba), pero se copia
 *  aquí para no arrastrar a RR. HH. el módulo de Entregas entero. */
export const ZONA_DE_RRHH = "America/Chicago";

type Instante = string | number | Date;

const MS_DIA = 86_400_000;

function aMs(instante: Instante): number {
  if (instante instanceof Date) return instante.getTime();
  if (typeof instante === "number") return instante;
  return Date.parse(instante);
}

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(locale: string, opciones: Intl.DateTimeFormatOptions, zona: string): Intl.DateTimeFormat {
  const clave = `${locale}|${zona}|${JSON.stringify(opciones)}`;
  let f = formatos.get(clave);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opciones, timeZone: zona });
    formatos.set(clave, f);
  }
  return f;
}

type Pared = { y: number; mo: number; d: number; h: number; mi: number; s: number };

/** La hora de reloj de Brownsville en un instante. */
function paredEn(ms: number): Pared {
  const partes = formato("en-US", {
    hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }, ZONA_DE_RRHH).formatToParts(new Date(ms));
  const n = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value ?? NaN);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute"), s: n("second") };
}

/** Minutos que hay que SUMAR a la hora UTC para tener la de Brownsville en ese instante: −300 en verano, −360 en invierno. */
export function desfaseDeBrownsvilleMin(instante: Instante): number {
  const ms = aMs(instante);
  const p = paredEn(ms);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60_000);
}

const dos = (n: number) => String(n).padStart(2, "0");
const PARED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * «AAAA-MM-DDTHH:mm» (lo que da un `<input type="datetime-local">`) leído como hora de Brownsville → el instante.
 * `null` si el texto no es una fecha y hora válidas. Da lo mismo en qué zona esté el aparato: no se usa la suya.
 */
export function instanteDePared(pared: string): Date | null {
  const m = PARED.exec((pared ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const comoUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(comoUtc).getUTCDate() !== d) return null; // 31 de abril y compañía
  // El desfase de la víspera y el del día siguiente: si hay un cambio de horario cerca, uno es el de antes y otro el de
  // después. Vale el que, aplicado, vuelve a dar la misma hora de reloj.
  const antes = desfaseDeBrownsvilleMin(comoUtc - MS_DIA);
  const despues = desfaseDeBrownsvilleMin(comoUtc + MS_DIA);
  const buenos = [...new Set([antes, despues])]
    .map((o) => comoUtc - o * 60_000)
    .filter((ms) => { const p = paredEn(ms); return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi; })
    .sort((a, b) => a - b);
  // Repetida: la primera. No existe (ningún desfase la da): con el de antes del salto cae una hora más tarde.
  return new Date(buenos.length ? buenos[0] : comoUtc - antes * 60_000);
}

/** El instante → «AAAA-MM-DDTHH:mm» en Brownsville, para el `value` de un `<input type="datetime-local">`. "" si no hay. */
export function paredDeInstante(instante: Instante | null | undefined): string {
  if (instante == null || instante === "") return "";
  const ms = aMs(instante);
  if (Number.isNaN(ms)) return "";
  const p = paredEn(ms);
  return `${p.y}-${dos(p.mo)}-${dos(p.d)}T${dos(p.h)}:${dos(p.mi)}`;
}

/** El día («AAAA-MM-DD») en Brownsville de un instante. */
export function diaEnBrownsville(instante: Instante): string {
  const p = paredEn(aMs(instante));
  return `${p.y}-${dos(p.mo)}-${dos(p.d)}`;
}

/** Hoy en Brownsville («AAAA-MM-DD»). `ahora` solo para medir. */
export function hoyEnBrownsville(ahora: Date = new Date()): string {
  return diaEnBrownsville(ahora);
}

/** Año y mes (0–11) en Brownsville de un instante. */
export function mesEnBrownsville(instante: Instante): { y: number; m: number } {
  const p = paredEn(aMs(instante));
  return { y: p.y, m: p.mo - 1 };
}

/** «AAAA-MM-DD» + n días, aritmética de calendario pura (sin zona, sin horas de 23 o 25). */
export function sumarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${dos(t.getUTCMonth() + 1)}-${dos(t.getUTCDate())}`;
}

/** Un instante formateado en hora de Brownsville. La única forma de pintar una hora en RR. HH. */
export function formatoEnBrownsville(instante: Instante, locale: string, opciones: Intl.DateTimeFormatOptions): string {
  const ms = aMs(instante);
  if (Number.isNaN(ms)) return "";
  return formato(locale, opciones, ZONA_DE_RRHH).format(new Date(ms));
}

/** Un DÍA de calendario («AAAA-MM-DD», sin hora: registro, seguimiento, fecha de ingreso) formateado tal cual. No pasa
 *  por ninguna zona horaria, así que no se corre de día en ningún aparato. */
export function formatoDeDia(dia: string, locale: string, opciones: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dia.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  return formato(locale, opciones, "UTC").format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** Cuántos días tiene un mes (0–11) y en qué día de la semana (0 = domingo) empieza: la cuadrícula del calendario. */
export function cuadriculaDelMes(y: number, m: number): { dias: number; empieza: number } {
  return { dias: new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), empieza: new Date(Date.UTC(y, m, 1)).getUTCDay() };
}
