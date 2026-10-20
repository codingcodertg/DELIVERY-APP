import { ayudaEnLaRuta } from "@/lib/ayuda-flotante";

/* ---- Chat interno (D-609, 2026-10-20; migración 184) ----
 * El dueño: «un chat dentro del app en general … un botón que se puede ocultar … en el right upper corner … chat con los de
 * su tienda y … buscar el nombre para mandar un chat a esa persona … esa persona en su hub va a ver un botón con todos los
 * contactos, tipo Facebook … si es un admin siempre son push messages».
 *
 * Aquí vive lo que decide: quién sale en la lista y en qué orden, cómo se agrupan los mensajes en hilos, cuántos hay sin
 * leer, qué cuerpo vale, y cuándo un mensaje lleva push. Lo que pinta (`ChatFlotante.tsx`) y lo que escribe
 * (`/api/chat/send`) pasan por aquí para poder medirlo. */

export const KIND_CHAT = "chat";
export const LARGO_MAXIMO = 2000;

export interface Contacto { id: string; full_name: string; store?: string | null; role?: string | null; title?: string | null }
export interface Mensaje { id: string; from_user: string; to_user: string; body: string; created_at: string; read_at: string | null }

/** ¿Sale la burbuja del chat en esta ruta? Las mismas pantallas sin sesión que la de Ayuda (login, track, baja…). */
export const chatEnLaRuta = (pathname: string | null): boolean => ayudaEnLaRuta(pathname);

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * La lista de contactos: sin uno mismo; si hay búsqueda, los que la contienen en el nombre (sin acentos ni mayúsculas);
 * primero los de MI tienda, luego el resto; dentro, por nombre. `yo.store` vacío = nadie es «de mi tienda».
 */
export function ordenaContactos<T extends Contacto>(contactos: readonly T[], yo: { id: string; store?: string | null }, busqueda = ""): T[] {
  const q = norm(busqueda);
  const mia = norm(yo.store);
  return contactos
    .filter((c) => c.id !== yo.id && (!q || norm(c.full_name).includes(q)))
    .sort((a, b) => {
      const am = mia && norm(a.store) === mia ? 0 : 1;
      const bm = mia && norm(b.store) === mia ? 0 : 1;
      return am - bm || norm(a.full_name).localeCompare(norm(b.full_name));
    });
}

export const esDeMiTienda = (c: Pick<Contacto, "store">, yo: { store?: string | null }): boolean => !!norm(yo.store) && norm(c.store) === norm(yo.store);

export interface Hilo { con: string; mensajes: Mensaje[]; noLeidos: number; ultimo: Mensaje | null }

/** Los hilos de una persona: uno por interlocutor, mensajes del más viejo al más nuevo, cuántos le mandaron sin leer. */
export function hilos(mensajes: readonly Mensaje[], yo: string): Map<string, Hilo> {
  const m = new Map<string, Hilo>();
  const orden = [...mensajes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const x of orden) {
    if (x.from_user !== yo && x.to_user !== yo) continue;
    const con = x.from_user === yo ? x.to_user : x.from_user;
    const h = m.get(con) ?? { con, mensajes: [], noLeidos: 0, ultimo: null };
    h.mensajes.push(x);
    h.ultimo = x;
    if (x.to_user === yo && !x.read_at) h.noLeidos++;
    m.set(con, h);
  }
  return m;
}

/** Los interlocutores con conversación, del más reciente al más viejo. */
export function hilosRecientes(h: ReadonlyMap<string, Hilo>): Hilo[] {
  return [...h.values()].sort((a, b) => (b.ultimo?.created_at ?? "").localeCompare(a.ultimo?.created_at ?? ""));
}

export const noLeidosTotal = (h: ReadonlyMap<string, Hilo>): number => [...h.values()].reduce((n, x) => n + x.noLeidos, 0);

/** El cuerpo que se manda: sin espacios de sobra, de 1 a 2000 letras; `null` si no vale. */
export function cuerpoValido(texto: string | null | undefined): string | null {
  const t = (texto ?? "").replace(/\r\n/g, "\n").trim();
  return t.length >= 1 && t.length <= LARGO_MAXIMO ? t : null;
}

/** Un mensaje de un ADMIN llega como push al teléfono; los demás, solo campana y burbuja. */
export const llevaPush = (rolDelRemitente: string | null | undefined): boolean => rolDelRemitente === "admin";

/** El aviso en la campana (y el push): quién y qué, recortado. */
export function textoDelAviso(nombre: string | null | undefined, cuerpo: string): string {
  const quien = (nombre ?? "").trim() || "Chat";
  const c = cuerpo.replace(/\s+/g, " ").trim();
  return `💬 ${quien}: ${c.length > 140 ? c.slice(0, 139) + "…" : c}`;
}

export type EstadoDeLaBurbuja = "oculta" | "burbuja" | "abierta";
export const CLAVE_DE_ESTADO = "chat-interno-estado";

/** Lo que se guarda en el navegador: solo si está oculta (la burbuja vuelve al recargar; el panel abierto no se recuerda). */
export function estadoInicial(guardado: string | null): EstadoDeLaBurbuja {
  return guardado === "oculta" ? "oculta" : "burbuja";
}

/** Un mensaje que llega por tiempo real entra una vez, aunque la suscripción lo repita. */
export function conMensaje(lista: readonly Mensaje[], m: Mensaje): Mensaje[] {
  return lista.some((x) => x.id === m.id) ? lista.map((x) => (x.id === m.id ? m : x)) : [...lista, m];
}
