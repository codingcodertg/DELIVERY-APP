/**
 * El cierre de sesión de las 18:30 (D-NEXT).
 *
 * Pedido por el dueño: a las 6:30 PM todo el mundo sale, menos él y los administradores, y al
 * volver solo hay que poner la contraseña — la cuenta sigue recordada (D-193).
 *
 * Lógica pura, sin red ni React, porque la misma regla la tienen que contestar igual **tres
 * sitios**: el middleware, que es la barrera de verdad; la pantalla, que avisa unos minutos
 * antes para que no sea un corte a traición; y las pruebas. Tres copias de una condición de
 * seguridad es como se cuela un rol (D-240), así que hay una.
 */

import { BUSINESS_TZ } from "@/lib/utils";

/**
 * La hora del corte, en la zona del negocio, en `HH:MM` de 24 h.
 *
 * **Clavada aquí y no en Ajustes, a propósito.** Un ajuste editable de esto no es un campo más:
 * es una palanca que deja a alguien fuera de la app, y equivocarse escribiendo «8:30» cierra la
 * empresa a media mañana. Mientras sea una sola hora para todos, un despliegue es un precio
 * bajo por que el cambio pase por una revisión. Si el dueño quiere moverla sin desplegar, eso
 * es otro encargo y lleva su propia validación.
 */
export const CIERRE_DIARIO = "18:30";

/** Cuántos minutos antes avisa la pantalla. Cortesía, no barrera: la barrera es el servidor. */
export const AVISO_MINUTOS_ANTES = 10;

/**
 * Quién NO cierra.
 *
 * Son **dos preguntas y no una lista**, porque los dos roles viven en tablas distintas: `admin`
 * es de Entregas (`public.profiles.role`) y `owner` es de fichaje (`clockin.profiles.role`).
 * Meterlos en un solo array de cadenas habría hecho que un `manager` de fichaje —que no existe
 * en Entregas— se comparara contra la lista equivocada.
 *
 * Y la lista dice a quién se **exime**, no a quién se cierra: un rol nuevo cierra por defecto,
 * que es la dirección segura. Hay una prueba que recorre `ROLE_INFO` y lo exige.
 */
export const CIERRE_EXENTO_ENTREGAS: readonly string[] = ["admin"];
export const CIERRE_EXENTO_FICHAJE: readonly string[] = ["owner"];

/** ¿Esta persona se queda dentro después del corte? */
export function exentoDelCierre(roles: {
  entregas?: string | null;
  fichaje?: string | null;
}): boolean {
  const e = (roles.entregas ?? "").trim().toLowerCase();
  const f = (roles.fichaje ?? "").trim().toLowerCase();
  return CIERRE_EXENTO_ENTREGAS.includes(e) || CIERRE_EXENTO_FICHAJE.includes(f);
}

/** La hora del negocio ahora mismo, en `HH:MM`. Misma zona en servidor y navegador. */
export function horaDelNegocio(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(ahora);
}

/** `"18:30"` → minutos desde medianoche. `-1` si la cadena no es una hora. */
export function minutosDeHHMM(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return -1;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return -1;
  return h * 60 + min;
}

/**
 * ¿Ya pasó el corte de HOY?
 *
 * Se compara en minutos y no como texto: `"18:30" > "09:00"` funciona por casualidad con el
 * cero delante, y dejaría de funcionar el día que alguien escriba `"9:00"`.
 */
export function pasoElCorte(ahoraHHMM: string, corte: string = CIERRE_DIARIO): boolean {
  const a = minutosDeHHMM(ahoraHHMM), c = minutosDeHHMM(corte);
  // Una hora que no se entiende **no** cierra a nadie. Es la dirección segura aquí, al revés
  // que en los roles: un fallo de formato no puede echar a toda la empresa de la app.
  if (a < 0 || c < 0) return false;
  return a >= c;
}

/**
 * Minutos que faltan para el corte, para el aviso previo. Negativo si ya pasó.
 * `null` si alguna hora no se entiende, y entonces la pantalla no avisa de nada.
 */
export function minutosHastaElCorte(ahoraHHMM: string, corte: string = CIERRE_DIARIO): number | null {
  const a = minutosDeHHMM(ahoraHHMM), c = minutosDeHHMM(corte);
  if (a < 0 || c < 0) return null;
  return c - a;
}

/** ¿Toca enseñar el aviso de «se va a cerrar»? Solo en la ventana previa, no después. */
export function tocaAvisar(ahoraHHMM: string, corte: string = CIERRE_DIARIO, minutos: number = AVISO_MINUTOS_ANTES): boolean {
  const faltan = minutosHastaElCorte(ahoraHHMM, corte);
  return faltan !== null && faltan > 0 && faltan <= minutos;
}

/**
 * El último corte que YA pasó, como instante.
 *
 * Es la pieza que hace que la regla cubra la mañana siguiente. A las 20:00 el último corte es
 * el de hoy; a las 09:00 es el de **ayer**, así que una sesión de ayer por la tarde tampoco
 * vale hoy al llegar a la oficina, y quien entró hoy a las 08:00 sigue dentro a las 17:00
 * porque su sesión es posterior al corte de ayer.
 *
 * Se calcula en la zona del negocio y no en la del servidor: Vercel corre en UTC y con el reloj
 * del servidor el corte se movería dos veces al año, cuando cambia el horario de verano.
 */
export function ultimoCortePasado(ahora: Date = new Date(), corte: string = CIERRE_DIARIO): Date | null {
  const min = minutosDeHHMM(corte);
  if (min < 0) return null;
  const hoy = pasoElCorte(horaDelNegocio(ahora), corte);
  const dia = new Date(ahora.getTime() - (hoy ? 0 : 86_400_000));
  return instanteEnZona(dia, min);
}

/** El instante UTC cuyo reloj local en `BUSINESS_TZ` es ese minuto del día de `dia`. */
function instanteEnZona(dia: Date, minutosDelDia: number): Date {
  // Se busca por diferencia en vez de por aritmética de husos: se toma un candidato, se mira
  // qué hora local tiene de verdad, y se corrige. Dos vueltas bastan y el cambio de horario
  // sale bien solo, sin tabla de husos ni una dependencia nueva.
  let t = Date.UTC(
    Number(new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year: "numeric" }).format(dia)),
    Number(new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, month: "2-digit" }).format(dia)) - 1,
    Number(new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, day: "2-digit" }).format(dia)),
    Math.floor(minutosDelDia / 60), minutosDelDia % 60,
  );
  for (let i = 0; i < 2; i++) {
    const local = minutosDeHHMM(horaDelNegocio(new Date(t)));
    if (local < 0) return new Date(t);
    let delta = minutosDelDia - local;
    // El desfase nunca es de medio día: si sale así, es que se cruzó la medianoche.
    if (delta > 720) delta -= 1440;
    if (delta < -720) delta += 1440;
    if (delta === 0) break;
    t += delta * 60_000;
  }
  return new Date(t);
}

/**
 * LA REGLA, en una sola función.
 *
 * Cierra si la sesión se autenticó **antes** del último corte que ya pasó. Y falla **hacia no
 * cerrar** en todo lo demás: sin hora de sesión —la función de base todavía no existe, o el
 * JWT no trajo `session_id`— nadie se queda fuera. Es deliberado: equivocarse cerrando deja a
 * la empresa entera sin app, y equivocarse abriendo solo alarga una sesión hasta el corte
 * siguiente.
 */
export function debeCerrarSesion(args: {
  sesionCreadaEn: Date | null | undefined;
  rolEntregas?: string | null;
  rolFichaje?: string | null;
  ahora?: Date;
}): boolean {
  if (!args.sesionCreadaEn) return false;
  if (exentoDelCierre({ entregas: args.rolEntregas, fichaje: args.rolFichaje })) return false;
  const corte = ultimoCortePasado(args.ahora ?? new Date());
  if (!corte) return false;
  return args.sesionCreadaEn.getTime() < corte.getTime();
}
