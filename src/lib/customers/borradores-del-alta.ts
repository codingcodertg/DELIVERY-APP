import { borradorDe, claveDelBorradorDelAlta, huellaDelBorrador, leeBorradorDelAlta, VERSION_DEL_BORRADOR, type BorradorDelAlta } from "./borrador-del-alta";
import { nombreDeTienda } from "./reglas";
import { telefonoEstandar } from "@/lib/recruiting/formato";

/**
 * VARIOS borradores del alta, en una lista aparte. Roberto Rodriguez Jr (admin), 2026-11-04, el mismo día de D-847: «show
 * the list of the drafts separately so you can have many». D-847 guardaba UNO por persona y guardar otro lo sustituía.
 *
 * Cada borrador lleva su `id` y lo de D-847 (cuándo se guardó, el formulario, los contactos, las redes y las tiendas). El
 * nombre y el resumen que enseña la lista NO se guardan: se sacan de lo guardado (`nombreDelBorrador`,
 * `resumenDelBorrador`), y así nunca dicen otra cosa que el formulario.
 *
 * DÓNDE: sigue en ESTE navegador, por persona (`localStorage`, clave `rtg_customers_new_drafts_<id>`), como D-847. Una
 * tabla en la base daría los borradores en cualquier computadora, pero es una migración con su RLS y nadie lo ha pedido.
 * El precio, que se dice: no viajan a otra computadora ni a otro navegador, y borrar los datos del sitio los borra.
 *
 * LA CLAVE VIEJA (D-847, `rtg_customers_new_draft_<id>`): al leer la lista, si hay un borrador en la vieja, pasa a la
 * lista y la vieja se borra, SOLO si la lista se pudo escribir. Si no se pudo, la vieja se queda (y se enseña igual), y
 * se intenta otra vez la próxima. Nunca se pierde.
 *
 * TOPE: `MAX_BORRADORES` por persona. Al llegar, guardar uno NUEVO dice que no y por qué (quien llama lo enseña); no se
 * tira el más viejo a escondidas. Actualizar uno que ya está sí se puede siempre.
 *
 * Todo con try/catch: un navegador sin almacenamiento (o que lo niega, o lleno) no rompe la pantalla; leer da la lista
 * vacía, y guardar o borrar dicen que no se pudo.
 */

export interface BorradorGuardado extends BorradorDelAlta {
  id: string;
}

/** Los borradores que caben por persona. Bastantes para el día a día; pocos para no llenar el navegador. */
export const MAX_BORRADORES = 50;

export const claveDeLosBorradores = (userId: string): string => `rtg_customers_new_drafts_${userId}`;

/** El almacenamiento del navegador (o uno de prueba). Es una función: acceder a `localStorage` ya puede lanzar. */
export type AlmacenDelNavegador = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ResultadoDeGuardar = { ok: true; id: string; creado: boolean } | { ok: false; motivo: "tope" | "almacen" };

/** Un id corto y único para un borrador. */
export function nuevoIdDeBorrador(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* abajo, sin crypto */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** El más reciente primero. */
const masRecientePrimero = (a: BorradorGuardado, b: BorradorGuardado) => (a.guardado < b.guardado ? 1 : a.guardado > b.guardado ? -1 : 0);

/** Lo leído, comprobado borrador a borrador: lo que no tiene forma de borrador se cae, y un id repetido cuenta una vez. */
export function borradoresDe(crudo: unknown): BorradorGuardado[] {
  if (!crudo || typeof crudo !== "object") return [];
  const o = crudo as Record<string, unknown>;
  if (o.v !== VERSION_DEL_BORRADOR || !Array.isArray(o.borradores)) return [];
  const vistos = new Set<string>();
  const lista: BorradorGuardado[] = [];
  for (const x of o.borradores) {
    if (!x || typeof x !== "object") continue;
    const id = (x as Record<string, unknown>).id;
    if (typeof id !== "string" || !id.trim() || vistos.has(id)) continue;
    const b = borradorDe({ ...(x as Record<string, unknown>), v: VERSION_DEL_BORRADOR });
    if (!b) continue;
    vistos.add(id);
    lista.push({ id, ...b });
  }
  return lista.sort(masRecientePrimero);
}

const texto = (lista: readonly BorradorGuardado[]) =>
  JSON.stringify({ v: VERSION_DEL_BORRADOR, borradores: lista.map(({ id, guardado, form, contactos, redes, tiendas }) => ({ id, guardado, form, contactos, redes, tiendas })) });

/** Escribe la lista entera (vacía: quita la clave). false si el navegador no dejó. */
function escribe(almacen: AlmacenDelNavegador, userId: string, lista: readonly BorradorGuardado[]): boolean {
  try {
    if (lista.length) almacen().setItem(claveDeLosBorradores(userId), texto(lista));
    else almacen().removeItem(claveDeLosBorradores(userId));
    return true;
  } catch { return false; }
}

/** La lista tal como está escrita, sin pasar la clave vieja. */
function leeLaLista(almacen: AlmacenDelNavegador, userId: string): BorradorGuardado[] {
  try {
    const crudo = almacen().getItem(claveDeLosBorradores(userId));
    return crudo ? borradoresDe(JSON.parse(crudo)) : [];
  } catch { return []; }
}

/**
 * Los borradores de esta persona, el más reciente primero. Pasa el de la clave vieja (D-847) a la lista, una vez: si ya
 * estaba (mismo contenido y misma hora, de un paso anterior que no pudo borrar la vieja), no se duplica.
 */
export function leeBorradores(almacen: AlmacenDelNavegador, userId: string, nuevoId: () => string = nuevoIdDeBorrador): BorradorGuardado[] {
  const lista = leeLaLista(almacen, userId);
  const viejo = leeBorradorDelAlta((k) => almacen().getItem(k), userId);
  if (!viejo) return lista;
  const yaEsta = lista.some((b) => b.guardado === viejo.guardado && huellaDelBorrador(b) === huellaDelBorrador(viejo));
  // El tope no cuenta aquí: el borrador viejo ya existía, y pasarlo a la lista no puede costar perderlo.
  const conElViejo = yaEsta ? lista : [...lista, { id: nuevoId(), ...viejo }].sort(masRecientePrimero);
  if (yaEsta || escribe(almacen, userId, conElViejo)) {
    try { almacen().removeItem(claveDelBorradorDelAlta(userId)); } catch { /* se intenta otra vez la próxima */ }
  }
  return conElViejo;
}

/**
 * Guarda un borrador. Con `id` de uno que está, lo ACTUALIZA (y pasa arriba); sin `id`, o si ese ya no está (se borró en
 * otra pestaña), crea uno nuevo, si cabe. Dice si lo creó, para que el aviso lo diga.
 */
export function guardaBorrador(
  almacen: AlmacenDelNavegador, userId: string, datos: BorradorDelAlta, id: string | null, nuevoId: () => string = nuevoIdDeBorrador,
): ResultadoDeGuardar {
  const lista = leeBorradores(almacen, userId, nuevoId);
  const esta = id !== null && lista.some((b) => b.id === id);
  if (!esta && lista.length >= MAX_BORRADORES) return { ok: false, motivo: "tope" };
  const elId = esta && id !== null ? id : nuevoId();
  const nueva = [{ ...datos, id: elId }, ...lista.filter((b) => b.id !== elId)].sort(masRecientePrimero);
  return escribe(almacen, userId, nueva) ? { ok: true, id: elId, creado: !esta } : { ok: false, motivo: "almacen" };
}

/** Borra UN borrador (el que se descartó, o el del alta que ya se creó o se pidió). false si el navegador no dejó. */
export function borraBorrador(almacen: AlmacenDelNavegador, userId: string, id: string, nuevoId: () => string = nuevoIdDeBorrador): boolean {
  const lista = leeBorradores(almacen, userId, nuevoId);
  if (!lista.some((b) => b.id === id)) return true;
  return escribe(almacen, userId, lista.filter((b) => b.id !== id));
}

/** El nombre de la cuenta, o «(untitled)» / «(sin nombre)» si aún no tiene. */
export function nombreDelBorrador(b: Pick<BorradorDelAlta, "form">, t: (en: string, es: string) => string): string {
  return b.form.account?.trim() || t("(untitled)", "(sin nombre)");
}

/**
 * Una línea para reconocerlo: el primer contacto (su nombre; si no tiene, su teléfono en la forma del hub o su correo en
 * minúsculas) y las tiendas marcadas (tres o más: la primera y «+N»).
 */
export function resumenDelBorrador(b: Pick<BorradorDelAlta, "contactos" | "tiendas" | "form">): string {
  const c = b.contactos.find((x) => [x.name, ...x.phones, ...x.emails].some((v) => v.trim()));
  const quien = c ? c.name.trim() || telefonoEstandar(c.phones.find((v) => v.trim())) || c.emails.find((v) => v.trim())?.trim().toLowerCase() || "" : "";
  const codigos = b.tiendas.length ? b.tiendas : b.form.store?.trim() ? [b.form.store] : [];
  const tiendas = codigos.length > 2 ? `${nombreDeTienda(codigos[0])} +${codigos.length - 1}` : codigos.map(nombreDeTienda).join(", ");
  return [quien, tiendas].filter(Boolean).join(" · ");
}
