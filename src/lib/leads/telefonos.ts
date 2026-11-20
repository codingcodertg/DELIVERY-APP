import { telefonoEstandar } from "../recruiting/formato";
import type { Lead } from "./reglas";

/**
 * Teléfonos de un lead (migración 335): el que se añade a mano y el que trae el Excel. Sin base y sin navegador.
 *
 * - Un teléfono a mano vive en SUS columnas (`owner_phone_manual`, `tenant_phone_manual`): ningún import lo toca. La
 *   pantalla enseña el de mano si lo hay; si no, el del Excel (`telefonoDeContratista`, `telefonoDeOtro`).
 * - «Contratista» (owner_*) es el teléfono que cuenta para el filtro «Sin teléfono», el cotizador y la búsqueda de
 *   teléfono; en un lead privado es el del contratista (a quien se le vende), y en uno del estado, el del dueño.
 * - La forma guardada es la del hub: «(956) 555-0123», con « ext. N» si lo tiene. La base hace la misma cuenta.
 */

/** La parte del número, sin la extensión. */
const parteDelNumero = (t: string): string => t.split(/\s+ext\.?\s*/i)[0] ?? "";
/** Un número con menos de 7 dígitos no sirve para llamar (igual que `telUrl`). */
export const tieneTelefono = (t: string | null | undefined): boolean => parteDelNumero((t ?? "").trim()).replace(/\D/g, "").length >= 7;

/** El teléfono de mano si lo hay; si no, el del Excel. null si ninguno tiene texto. */
export function telefonoDeContratista(l: Pick<Lead, "owner_phone" | "owner_phone_manual">): string | null {
  const mano = (l.owner_phone_manual ?? "").trim();
  if (mano) return mano;
  const excel = (l.owner_phone ?? "").trim();
  return excel || null;
}
export function telefonoDeOtro(l: Pick<Lead, "tenant_phone" | "tenant_phone_manual">): string | null {
  const mano = (l.tenant_phone_manual ?? "").trim();
  if (mano) return mano;
  const excel = (l.tenant_phone ?? "").trim();
  return excel || null;
}

/** Un lead SIN teléfono de contratista: ni de mano ni del Excel que sirva para llamar. */
export const sinTelefono = (l: Pick<Lead, "owner_phone" | "owner_phone_manual">): boolean => !tieneTelefono(telefonoDeContratista(l));

export type MotivoTelefono = "vacio" | "digitos" | "ext";

/**
 * Valida y da forma a un teléfono de EE. UU.: 10 dígitos (o 1 + 10). Extensión opcional de hasta 6 dígitos. Si el
 * número trae «ext» escrito, lo que va después es la extensión (si el campo de extensión está vacío).
 */
export function validaTelefono(entrada: string, extension = ""): { ok: true; valor: { telefono: string; ext: string | null } } | { ok: false; motivo: MotivoTelefono } {
  const partes = (entrada ?? "").split(/\s*\bext\.?\s*/i);
  let d = (partes[0] ?? "").replace(/\D/g, "");
  if (!d) return { ok: false, motivo: "vacio" };
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return { ok: false, motivo: "digitos" };
  const ext = (extension ?? "").trim() || (partes[1] ?? "").trim();
  if (ext && !/^\d{1,6}$/.test(ext)) return { ok: false, motivo: "ext" };
  return { ok: true, valor: { telefono: telefonoBonito(d), ext: ext || null } };
}

/** «9565550123» → «(956) 555-0123». La misma forma que `telefonoEstandar` y que la base. */
export const telefonoBonito = (diez: string): string => telefonoEstandar(diez);

/** Lo que se muestra: el número en la forma del hub, y la extensión a la vista. */
export function telefonoParaMostrar(t: string | null | undefined): string {
  const limpio = (t ?? "").trim();
  if (!limpio) return "";
  const m = /^(.*?)\s+ext\.?\s*(\d+)$/i.exec(limpio);
  if (m) return `${telefonoEstandar(m[1])} ext. ${m[2]}`;
  return telefonoEstandar(limpio);
}

/**
 * El nombre de un contratista para comparar dos leads. Minúsculas, sin acentos, sin puntuación, sin «LLC / Inc / Co /
 * Corp / Ltd / The / Company», espacios de uno. Menos de 4 letras no cuenta. Si trae coma («Apellido, Nombre»), también
 * cuenta «Nombre Apellido». Límites: no corrige erratas; «Const» y «Construction» no son lo mismo; «and» no es «&».
 */
export function clavesDeContratista(nombre: string | null | undefined): string[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.,'"&()/\-]/g, " ").replace(/\b(llc|inc|incorporated|co|corp|corporation|ltd|the|company)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  const limpio = (nombre ?? "").trim();
  if (!limpio) return [];
  const claves = [norm(limpio)];
  const partes = limpio.split(",");
  if (partes.length === 2 && partes[0].trim() && partes[1].trim()) claves.push(norm(`${partes[1]} ${partes[0]}`));
  return [...new Set(claves.filter((k) => k.length >= 4))];
}

export interface Sugerencia {
  telefono: string;
  origen: { tipo: "permiso"; tabs: string; nombre: string } | { tipo: "cliente"; cuenta: string };
}

/**
 * Un teléfono que el lead no tiene y que otro lead SÍ tiene, a la vista de quien mira (solo lo que ya se le cargó):
 *  1. Otro permiso del MISMO contratista (mismo nombre normalizado, misma fuente). Gana el de mano; si empatan, el más
 *     reciente.
 *  2. El teléfono del cliente cruzado (`customer_match_id`), solo el campo `phone` que la pantalla ya lee.
 * Es una lectura: no escribe nada hasta que alguien la usa.
 */
export function sugerenciaDeTelefono(
  lead: Lead,
  todos: readonly Lead[],
  clientes: ReadonlyMap<number, { account: string; phone: string | null }>,
): Sugerencia | null {
  if (!sinTelefono(lead)) return null;
  const claves = new Set(clavesDeContratista(lead.owner_name));
  if (claves.size) {
    const fuente = lead.source ?? "tdlr";
    const otros = todos.filter((o) => o.id !== lead.id && o.status !== "archived" && (o.source ?? "tdlr") === fuente
      && tieneTelefono(telefonoDeContratista(o)) && clavesDeContratista(o.owner_name).some((k) => claves.has(k)));
    otros.sort((a, b) => Number(!!(b.owner_phone_manual ?? "").trim()) - Number(!!(a.owner_phone_manual ?? "").trim())
      || String(b.last_at ?? b.imported_at ?? "").localeCompare(String(a.last_at ?? a.imported_at ?? "")));
    const elegido = otros[0];
    if (elegido) {
      return { telefono: telefonoDeContratista(elegido)!, origen: { tipo: "permiso", tabs: elegido.tabs_project, nombre: elegido.owner_name ?? "" } };
    }
  }
  if (lead.customer_match_id != null) {
    const c = clientes.get(lead.customer_match_id);
    if (c && tieneTelefono(c.phone)) return { telefono: (c.phone ?? "").trim(), origen: { tipo: "cliente", cuenta: c.account } };
  }
  return null;
}

/** Búsqueda en Google para encontrar el teléfono: contratista + ciudad de la obra + «phone». Sin API ni scraping. */
export function enlaceDeBusqueda(l: Pick<Lead, "owner_name" | "tenant_name" | "site_city">): string | null {
  const quien = (l.owner_name ?? "").trim() || (l.tenant_name ?? "").trim();
  if (!quien) return null;
  const q = [quien, (l.site_city ?? "").trim(), "phone"].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/** Cuántos leads vigentes SIN teléfono de contratista hay en cada pool. Por nombre; «No store» al final. */
export function sinTelefonoPorPool(leads: readonly Lead[]): { pool: string; n: number }[] {
  const m = new Map<string, number>();
  for (const l of leads) {
    if (l.status === "archived" || !sinTelefono(l)) continue;
    m.set(l.pool, (m.get(l.pool) ?? 0) + 1);
  }
  return [...m].map(([pool, n]) => ({ pool, n })).sort((a, b) =>
    a.pool === "No store" ? 1 : b.pool === "No store" ? -1 : a.pool.localeCompare(b.pool));
}

/** El texto de la nota del historial: «Contratista: (956) 555-0123 · Juan», o «Contratista: quitado». */
export function notaDeTelefono(quien: "Contratista" | "Propietario", telefono: string | null, contacto: string | null): string {
  if (!telefono) return `${quien}: quitado`;
  const c = (contacto ?? "").trim();
  return `${quien}: ${telefono}${c ? ` · ${c}` : ""}`;
}
/** ¿Es la nota de un teléfono QUITADO (y no uno añadido)? */
export const esQuitado = (nota: string | null | undefined): boolean => /: quitado$/.test((nota ?? "").trim());

/**
 * Cuántos teléfonos se añadieron a mano en el mes de `ahora` (hora local) y quién los añadió. Un quitado no cuenta.
 * Se lee del historial (`kind = 'phone'`).
 */
export function telefonosAMano(
  eventos: readonly { kind: string; at: string; note: string | null; actor_name: string | null }[],
  ahora: Date,
): { total: number; porPersona: { nombre: string; n: number }[] } {
  const m = new Map<string, number>();
  let total = 0;
  for (const e of eventos) {
    if (e.kind !== "phone" || esQuitado(e.note)) continue;
    const f = new Date(e.at);
    if (Number.isNaN(f.getTime()) || f.getFullYear() !== ahora.getFullYear() || f.getMonth() !== ahora.getMonth()) continue;
    total++;
    const nombre = e.actor_name ?? "—";
    m.set(nombre, (m.get(nombre) ?? 0) + 1);
  }
  return { total, porPersona: [...m].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre)) };
}
