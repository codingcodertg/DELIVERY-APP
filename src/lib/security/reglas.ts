import type { UserRole } from "@/lib/types";

/**
 * La regla de acceso por dispositivo (D-811, migración 229), como función pura.
 *
 * El dueño: la empresa no quiere que la gente de oficina y ventas entre al hub «por la web» desde su casa. Cada
 * computadora de tienda con la app RTG Hub se registra; esas son las únicas desde las que esos roles entran a todo. Un
 * vendedor puede entrar desde su teléfono registrado, y ahí solo ve Time Tracker —y Quote Builder mientras tiene una
 * visita a cliente abierta—. Admin, warehouse y driver no tienen límite.
 *
 * **Nace apagada**: con `enforced` en false, `decideAcceso` siempre deja pasar. Y si la puerta no se pudo leer (la 229
 * sin aplicar, la red), el middleware pasa `null` y tampoco se cierra a nadie: la dirección segura es la de la 107.
 */

/** La cookie (y la clave de `localStorage`) con el id del dispositivo. 400 días: el máximo que Chrome respeta. */
export const COOKIE_DISPOSITIVO = "rtg_device";
export const DIAS_DE_COOKIE = 400;
/** La cabecera que SOLO pone la app de escritorio (`desktop/dispositivo.js`): un id ligado a la máquina, no copiable. */
export const CABECERA_DISPOSITIVO = "x-rtg-device";

/**
 * De dónde sale el id de esta petición: la cabecera de la app de escritorio manda (`ligado`: nació del MachineGuid de
 * esa PC); si no, la cookie del navegador o del teléfono. Un valor que no tiene forma de id se ignora.
 */
export function dispositivoDeLaPeticion(p: { cabecera: string | null | undefined; cookie: string | null | undefined }): { id: string; ligado: boolean } | null {
  const h = (p.cabecera ?? "").trim();
  if (idDeDispositivoValido(h)) return { id: h, ligado: true };
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_DISPOSITIVO}=([^;]+)`).exec(p.cookie ?? "");
  const c = m ? decodeURIComponent(m[1]).trim() : "";
  return idDeDispositivoValido(c) ? { id: c, ligado: false } : null;
}

/** Los roles que entran desde cualquier dispositivo, con la regla encendida. */
export const ROLES_SIN_LIMITE: readonly UserRole[] = ["admin", "warehouse", "driver"];

/**
 * D-816: los roles que NO entran desde un navegador de computadora: solo desde la app RTG Hub (y desde el teléfono,
 * al Time Tracker). El dueño: «office manager y sales people»; «office» aquí es logistics. Accounting entró después,
 * preguntado a propósito (D-817): «sí también accounting».
 */
export const ROLES_SOLO_ESCRITORIO: readonly UserRole[] = ["manager", "sales", "logistics", "accounting"];
/** Adónde va quien entra por la web con un rol que ya no puede. Pública en `route-guard`. */
export const RUTA_SOLO_ESCRITORIO = "/web-blocked";

export type TipoDeDispositivo = "desktop" | "phone" | "browser";
export type EstadoDeDispositivo = "none" | "pending" | "approved" | "revoked";

/** Lo que devuelve `public.security_gate(p_device)`. */
export interface PuertaDeDispositivo {
  enforced: boolean;
  role: string | null;
  device_status: string | null;
  device_kind: string | null;
  visit_open: boolean;
  /** D-816 (231): la web bloqueada para `ROLES_SOLO_ESCRITORIO`. Opcional: la 229 sola no lo devuelve. */
  web_blocked?: boolean | null;
  /** D-826 (235): quien llama está en la lista de excepciones de la web bloqueada. */
  web_exempt?: boolean | null;
}

/** Adónde va quien no puede estar donde está. Pública en `route-guard`: mandar aquí a quien ya entró no es un bucle. */
export const RUTA_BLOQUEADO = "/device-blocked";

/** Qué es este dispositivo, por su agente de usuario: la app de escritorio deja `RTGHub/` (D-280), un móvil se dice. */
export function tipoPorAgente(userAgent: string | null | undefined): TipoDeDispositivo {
  const ua = userAgent ?? "";
  if (/\b(RTGHub|RDZHub)\/\S*/.test(ua)) return "desktop";
  if (/\b(Android|iPhone|iPad|iPod|Mobile|RDZDeliveries)\b/i.test(ua)) return "phone";
  return "browser";
}

/** Un id de dispositivo que vale: lo que el cliente genera (`crypto.randomUUID()`), ni vacío ni gigante. */
export function idDeDispositivoValido(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/** Lo que un teléfono aprobado puede abrir: el Time Tracker entero, el hub y lo de la propia cuenta. */
const SIEMPRE_EN_TELEFONO = ["/timetracker", "/home", "/change-password", "/no-access", RUTA_BLOQUEADO, RUTA_SOLO_ESCRITORIO] as const;
/** D-816: lo que un navegador de computadora bloqueado aún puede abrir: la pantalla del bloqueo y lo de la cuenta. */
const EN_WEB_BLOQUEADA = [RUTA_SOLO_ESCRITORIO, RUTA_BLOQUEADO, "/change-password", "/no-access"] as const;
/** Y Quote Builder, solo mientras hay una visita a cliente abierta. */
const CON_VISITA = ["/estimator"] as const;

const bajo = (path: string, prefijo: string) => path === prefijo || path.startsWith(prefijo + "/");
/**
 * D-819: lo que NINGUNA de las dos reglas toca: salir (`/auth/signout`, el POST del botón «Cerrar sesión»), entrar y lo
 * de la cuenta sin sesión. El dueño: «le doy cerrar sesión y no me saca»: el rebote a /web-blocked se tragaba el POST.
 */
const FUERA_DE_LAS_REGLAS = ["/auth", "/login", "/reset-password"] as const;
const fueraDeLasReglas = (path: string) => FUERA_DE_LAS_REGLAS.some((p) => bajo(path, p));

export type DecisionDeDispositivo =
  | { kind: "next" }
  | { kind: "redirect"; to: string; motivo: "no_autorizado" | "solo_telefono" | "solo_escritorio" };

/**
 * La decisión para una navegación. `puerta` null = no se pudo leer: pasa.
 *
 *  · regla apagada, o rol sin límite → pasa.
 *  · dispositivo aprobado de computadora (desktop o browser aprobado a mano por el admin) → pasa.
 *  · teléfono aprobado → solo Time Tracker (+ Quote Builder con visita abierta); lo demás rebota a /timetracker.
 *  · pendiente, revocado o desconocido → /device-blocked.
 */
export function decideAcceso(path: string, puerta: PuertaDeDispositivo | null | undefined): DecisionDeDispositivo {
  if (!puerta || !puerta.enforced) return { kind: "next" };
  if (bajo(path, RUTA_BLOQUEADO) || fueraDeLasReglas(path)) return { kind: "next" };
  const role = (puerta.role ?? "") as UserRole;
  if (ROLES_SIN_LIMITE.includes(role)) return { kind: "next" };
  if (puerta.device_status !== "approved") return { kind: "redirect", to: RUTA_BLOQUEADO, motivo: "no_autorizado" };
  if (puerta.device_kind !== "phone") return { kind: "next" };
  if (SIEMPRE_EN_TELEFONO.some((p) => bajo(path, p))) return { kind: "next" };
  if (puerta.visit_open && CON_VISITA.some((p) => bajo(path, p))) return { kind: "next" };
  return { kind: "redirect", to: "/timetracker", motivo: "solo_telefono" };
}

/**
 * D-816: la web bloqueada, como función pura. Mira solo CON QUÉ entra la persona (su agente de usuario), no si el
 * dispositivo está aprobado: eso es la otra regla. `puerta` null o `web_blocked` falso → pasa.
 *
 *  · rol que no es de `ROLES_SOLO_ESCRITORIO` → pasa (admin, warehouse, driver, accounting).
 *  · la app de escritorio (agente `RTGHub/`) → pasa a todo. La 1.1.1 también: la pantalla de D-814 ya la obliga a
 *    actualizar, y aquí no se la deja fuera para no dejar sin salida a quien está actualizando.
 *  · un teléfono → solo Time Tracker (+ Quote Builder con visita abierta); lo demás rebota a /timetracker.
 *  · un navegador de computadora → /web-blocked, salvo en las pantallas de la propia cuenta.
 * Un admin dentro de «entrar como» no pasa por aquí (el middleware lo salta, como en D-811).
 */
export function decideWeb(path: string, puerta: PuertaDeDispositivo | null | undefined, userAgent: string | null | undefined): DecisionDeDispositivo {
  if (!puerta || !puerta.web_blocked) return { kind: "next" };
  if (fueraDeLasReglas(path)) return { kind: "next" };
  if (!ROLES_SOLO_ESCRITORIO.includes((puerta.role ?? "") as UserRole)) return { kind: "next" };
  // D-826: la excepción por persona («Nick y Francis tampoco los bloquees»).
  if (puerta.web_exempt) return { kind: "next" };
  const tipo = tipoPorAgente(userAgent);
  if (tipo === "desktop") return { kind: "next" };
  if (tipo === "phone") {
    if (SIEMPRE_EN_TELEFONO.some((p) => bajo(path, p))) return { kind: "next" };
    if (puerta.visit_open && CON_VISITA.some((p) => bajo(path, p))) return { kind: "next" };
    return { kind: "redirect", to: "/timetracker", motivo: "solo_telefono" };
  }
  if (EN_WEB_BLOQUEADA.some((p) => bajo(path, p))) return { kind: "next" };
  return { kind: "redirect", to: RUTA_SOLO_ESCRITORIO, motivo: "solo_escritorio" };
}

/** Las apps que el hub le enseña a quien está limitado al teléfono; `null` = sin límite, las suyas. */
export function appsEnElTelefono(puerta: PuertaDeDispositivo | null | undefined, userAgent?: string | null): string[] | null {
  if (!puerta) return null;
  const role = (puerta.role ?? "") as UserRole;
  // D-816: con la web bloqueada, un teléfono de esos roles solo ve el Time Tracker, esté o no aprobado el dispositivo.
  if (puerta.web_blocked && !puerta.web_exempt && ROLES_SOLO_ESCRITORIO.includes(role) && tipoPorAgente(userAgent) === "phone") {
    return puerta.visit_open ? ["timetracker", "estimator"] : ["timetracker"];
  }
  if (!puerta.enforced) return null;
  if (ROLES_SIN_LIMITE.includes(role)) return null;
  if (puerta.device_status !== "approved" || puerta.device_kind !== "phone") return null;
  return puerta.visit_open ? ["timetracker", "estimator"] : ["timetracker"];
}

/** Un nombre legible cuando el admin aún no le puso uno: «Chrome · Windows», «RTG Hub · Windows», «iPhone». */
export function nombrePorAgente(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const so = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iPhone" : /Mac OS/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const app = /\b(RTGHub|RDZHub)\//.test(ua) ? "RTG Hub" : /RDZDeliveries\//.test(ua) ? "App de choferes" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Navegador";
  return so ? `${app} · ${so}` : app;
}
