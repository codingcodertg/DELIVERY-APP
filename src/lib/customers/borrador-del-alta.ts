import type { ContactoEnEdicion } from "./contactos";
import { REDES, type RedesEnEdicion } from "./redes";

/**
 * «Save draft» en el alta de un cliente. Roberto Rodriguez Jr (admin), solicitud de ayuda 3914768b, 2026-11-04, con la
 * captura de «New customer» marcando el hueco junto a «Cancel»: «need a save draft». Un alta tiene muchos campos
 * obligatorios (D-772) y a menudo falta un dato que hay que pedirle al cliente; hasta ahora, cerrar la ventana lo tiraba
 * todo.
 *
 * DÓNDE SE GUARDA: en ESTE navegador, por persona (`localStorage`, con el id en la clave), como las vistas del Gestor
 * (`vistas-del-gestor.ts`) y los avisos cerrados (`avisos-ocultos.ts`), y por la misma razón: `user_prefs` tiene su lista de
 * claves cerrada en la base (136) y un tope de 8 KB, así que guardarlo allí sería una migración. Consecuencia que se dice:
 * el borrador no viaja a otra computadora ni a otro navegador. Un borrador por persona: guardar otro lo sustituye.
 *
 * Todo con try/catch: un navegador sin almacenamiento (o que lo niega, o lleno) no rompe la ficha; «Guardar borrador» dice
 * que no se pudo, y leer da «no hay borrador».
 */

export interface BorradorDelAlta {
  /** Cuándo se guardó (ISO). */
  guardado: string;
  form: Record<string, string>;
  contactos: ContactoEnEdicion[];
  redes: RedesEnEdicion;
  /** Las tiendas marcadas (D-664). */
  tiendas: string[];
}

/** Lo que se escribe en el navegador: con versión, para poder cambiar la forma sin leer basura. */
const VERSION = 1;

/** La clave del navegador, por persona: dos personas en la misma computadora no se pisan el borrador. */
export const claveDelBorradorDelAlta = (userId: string): string => `rtg_customers_new_draft_${userId}`;

const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function contactoDe(x: unknown): ContactoEnEdicion | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const phones = textos(o.phones);
  const emails = textos(o.emails);
  return {
    name: texto(o.name), title: texto(o.title), note: texto(o.note), website: texto(o.website), address: texto(o.address),
    // Como `enEdicion`: al menos un hueco de teléfono y uno de correo, para tener dónde escribir.
    phones: phones.length ? phones : [""], emails: emails.length ? emails : [""],
  };
}

/** Lo leído, comprobado campo a campo: lo que no tiene la forma esperada se cae, y si no queda nada útil, no hay borrador. */
export function borradorDe(crudo: unknown): BorradorDelAlta | null {
  if (!crudo || typeof crudo !== "object") return null;
  const o = crudo as Record<string, unknown>;
  if (o.v !== VERSION) return null;
  const form: Record<string, string> = {};
  if (o.form && typeof o.form === "object") {
    for (const [k, v] of Object.entries(o.form as Record<string, unknown>)) if (typeof v === "string") form[k] = v;
  }
  const contactos = (Array.isArray(o.contactos) ? o.contactos : []).map(contactoDe).filter((c): c is ContactoEnEdicion => c !== null);
  const r = o.redes && typeof o.redes === "object" ? (o.redes as Record<string, unknown>) : {};
  const redes = Object.fromEntries(REDES.map((k) => [k, texto(r[k])])) as RedesEnEdicion;
  const b: BorradorDelAlta = { guardado: texto(o.guardado), form, contactos, redes, tiendas: textos(o.tiendas) };
  return hayAlgoEscrito(b) ? b : null;
}

/**
 * Si hay algo escrito que valga la pena guardar. No cuenta lo que la ficha pone sola (`preajuste`: el vendedor del
 * vendedor, D-740, y la tienda de quien pide, D-767) ni las tiendas marcadas: una ficha recién abierta no es un borrador.
 */
export function hayAlgoEscrito(b: Pick<BorradorDelAlta, "form" | "contactos" | "redes">, preajuste: Record<string, string> = {}): boolean {
  const lleno = (s: string) => s.trim() !== "";
  if (Object.entries(b.form).some(([k, v]) => k !== "store" && lleno(v) && v !== preajuste[k])) return true;
  if (b.contactos.some((c) => [c.name, c.title, c.note, c.website, c.address, ...c.phones, ...c.emails].some(lleno))) return true;
  return REDES.some((k) => lleno(b.redes[k] ?? ""));
}

/** La huella de un borrador sin su hora: dos iguales son el mismo borrador (para no preguntar al cerrar lo ya guardado). */
export const huellaDelBorrador = (b: Pick<BorradorDelAlta, "form" | "contactos" | "redes" | "tiendas">): string =>
  JSON.stringify([b.form, b.contactos, REDES.map((k) => b.redes[k] ?? ""), b.tiendas]);

/** El borrador guardado por esta persona, o null (nada, basura, o un navegador que niega el almacenamiento). */
export function leeBorradorDelAlta(leer: (clave: string) => string | null, userId: string): BorradorDelAlta | null {
  try {
    const crudo = leer(claveDelBorradorDelAlta(userId));
    return crudo ? borradorDe(JSON.parse(crudo)) : null;
  } catch { return null; }
}

/** Guarda el borrador (sustituye al anterior). false si el navegador no dejó: quien llama lo dice. */
export function guardaBorradorDelAlta(almacen: () => { setItem(k: string, v: string): void }, userId: string, b: BorradorDelAlta): boolean {
  try {
    almacen().setItem(claveDelBorradorDelAlta(userId), JSON.stringify({ v: VERSION, ...b }));
    return true;
  } catch { return false; }
}

/** Lo borra: al descartarlo, o cuando el alta ya se creó (o se mandó como solicitud). */
export function borraBorradorDelAlta(almacen: () => { removeItem(k: string): void }, userId: string): void {
  try { almacen().removeItem(claveDelBorradorDelAlta(userId)); } catch { /* sin almacenamiento: no había nada que borrar */ }
}

/** Cuándo se guardó, para el aviso: «Nov 4, 2:31 PM» / «4 nov, 14:31». Una fecha que no se lee, vacío. */
export function cuandoSeGuardo(iso: string, lang: "en" | "es"): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "es" ? "es-MX" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
