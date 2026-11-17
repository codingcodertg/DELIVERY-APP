/**
 * ¿Este correo de Gmail es de verdad un correo de Indeed que pasó por la empresa? PURO: recibe las cabeceras, no toca red.
 *
 * Por qué no basta con el From: se puede falsificar. La prueba que sí cuenta es la firma DKIM de Indeed, y Gmail la
 * comprueba al recibir el correo y lo escribe en SU Authentication-Results. Gmail añade esa cabecera ARRIBA del todo, así
 * que la PRIMERA Authentication-Results del mensaje es la suya; lo que pusiera el remitente queda debajo y no se fía.
 *
 * (a) REDIRIGIDO: la regla de Outlook reenvía el correo de Indeed a Gmail. Se acepta si:
 *     1. El From original es de Indeed (indeed.com, indeedemail.com, indeedmail.com y sus subdominios).
 *     2. La primera Authentication-Results es de `mx.google.com` y dice `dkim=pass` con `header.d` de Indeed: la firma de
 *        Indeed sobrevivió al reenvío.
 *     3. Algún Received, X-Forwarded-For, Resent-From o X-MS-Exchange-* menciona rdztilegroup.net o protection.outlook.com:
 *        el correo pasó por el inquilino de Microsoft de la empresa. Sin esa huella es un correo de Indeed directo a Gmail
 *        (o un falso) y se rechaza.
 *
 * (b) REENVIADO EN LOTE: la bandeja careers@ reenvía varios correos de Indeed como adjuntos .eml en UN solo mensaje. Se
 *     acepta el mensaje exterior si:
 *     1. Su From es exactamente careers@rdztilegroup.net.
 *     2. La primera Authentication-Results es de `mx.google.com` y dice `dkim=pass` con `header.d` de rdztilegroup.net o
 *        de un dominio onmicrosoft.com (la firma de Microsoft de la empresa).
 *     Cada .eml adjunto se acepta solo si SU From es de Indeed: lo que verifica la firma exterior es que la empresa lo
 *     reenvió; el .eml interior puede llevar sus propias cabeceras, que no se usan para decidir.
 *
 * Cuando hay duda, se rechaza y el motivo se registra (sin cuerpo ni contraseña).
 */
import { DOMINIOS_INDEED } from "@/lib/outlook/config";
import type { CabeceraDeCorreo } from "@/lib/outlook/verificacion";

export type { CabeceraDeCorreo };

/** La bandeja de la empresa que reenvía los correos de Indeed en lote. */
export const CORREO_DE_COMPANIA = "careers@rdztilegroup.net";
const DOMINIO_EMPRESA = "rdztilegroup.net";
/** El único que puede poner una Authentication-Results por encima de todo: el servidor de Gmail que recibe el correo. */
const AUTHSERV_GMAIL = "mx.google.com";
/** Límite de lectura de cada cabecera (una cabecera de verdad no pasa de esto). */
const TOPE_CABECERA = 8000;

export type ResultadoVerificacion = { ok: true; motivo: string } | { ok: false; motivo: string };

const no = (motivo: string): ResultadoVerificacion => ({ ok: false, motivo });
const si = (motivo: string): ResultadoVerificacion => ({ ok: true, motivo });

function valoresDe(cabeceras: readonly CabeceraDeCorreo[], nombre: string): string[] {
  return cabeceras.filter((c) => c.name.trim().toLowerCase() === nombre).map((c) => c.value);
}

/** La dirección del From (la primera cabecera From), sin el nombre y en minúsculas. Null si no se lee una dirección. */
export function direccionDeFrom(cabeceras: readonly CabeceraDeCorreo[]): string | null {
  const v = valoresDe(cabeceras, "from")[0];
  if (!v) return null;
  const m = /<([^>]+)>/.exec(v);
  const cruda = (m ? m[1] : v).trim().toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(cruda) ? cruda : null;
}

function dominioDe(direccion: string | null): string | null {
  const i = direccion?.lastIndexOf("@") ?? -1;
  return direccion && i >= 0 ? direccion.slice(i + 1) : null;
}

/** ¿Es un dominio de Indeed (exacto o subdominio)? */
export function esDominioIndeed(dominio: string): boolean {
  return (DOMINIOS_INDEED as readonly string[]).some((d) => dominio === d || dominio.endsWith(`.${d}`));
}

/** La primera Authentication-Results: su authserv-id (quien la escribió) y sus resultados (lo que va tras el primer «;»). */
export function primeraAuthResults(cabeceras: readonly CabeceraDeCorreo[]): { authserv: string; resultados: string } | null {
  const v = valoresDe(cabeceras, "authentication-results")[0];
  if (v === undefined) return null;
  const t = v.slice(0, TOPE_CABECERA).replace(/\r?\n[ \t]+/g, " ");
  const i = t.indexOf(";");
  const authserv = (i < 0 ? t : t.slice(0, i)).replace(/\([^)]*\)/g, "").trim().toLowerCase();
  return { authserv, resultados: i < 0 ? "" : t.slice(i + 1) };
}

/** ¿Algún `dkim=pass` de estos resultados firma con un dominio que cumple `valido`? (mira header.d y, si falta, header.i). */
export function dkimPasaCon(resultados: string, valido: (dominio: string) => boolean): boolean {
  for (const parte of resultados.split(";")) {
    const t = parte.trim().toLowerCase();
    if (!/^dkim=pass(\s|$|\()/.test(t)) continue;
    const d = /\bheader\.d=@?([a-z0-9.-]+)/.exec(t)?.[1] ?? /\bheader\.i=@?([a-z0-9.-]+)/.exec(t)?.[1];
    if (d && valido(d)) return true;
  }
  return false;
}

/** Huella del paso por el inquilino de la empresa: Received, X-Forwarded-For, Resent-From o cabeceras X-MS-Exchange-*. */
const RE_HUELLA_EMPRESA = /rdztilegroup\.net|protection\.outlook\.com/i;

function pasoPorLaEmpresa(cabeceras: readonly CabeceraDeCorreo[]): boolean {
  return cabeceras.some((c) => {
    const n = c.name.trim().toLowerCase();
    const relevante = n === "received" || n === "x-forwarded-for" || n === "resent-from" || n.startsWith("x-ms-exchange-");
    return relevante && RE_HUELLA_EMPRESA.test(c.value);
  });
}

/** (a) Un correo de Indeed que la regla de Outlook redirigió a Gmail. Ver la cabecera del fichero. */
export function esCorreoDeIndeedReenviado(cabeceras: readonly CabeceraDeCorreo[]): ResultadoVerificacion {
  const from = direccionDeFrom(cabeceras);
  const dom = dominioDe(from);
  if (!from || !dom || !esDominioIndeed(dom)) return no("el From no es de Indeed");
  const ar = primeraAuthResults(cabeceras);
  if (!ar) return no("sin Authentication-Results de Gmail");
  if (ar.authserv !== AUTHSERV_GMAIL) return no("la primera Authentication-Results no es la de Gmail: no se fía");
  if (!dkimPasaCon(ar.resultados, esDominioIndeed)) return no("la firma DKIM de Indeed no pasó en Gmail");
  if (!pasoPorLaEmpresa(cabeceras)) return no("no pasó por el correo de la empresa (sin huella de rdztilegroup.net ni de Microsoft)");
  return si("redirigido: firma de Indeed válida y paso por la empresa");
}

/** (b) El mensaje exterior de careers@ que reenvía correos de Indeed como adjuntos. Ver la cabecera del fichero. */
export function esReenvioEnLoteDeCompania(cabeceras: readonly CabeceraDeCorreo[]): ResultadoVerificacion {
  if (direccionDeFrom(cabeceras) !== CORREO_DE_COMPANIA) return no("el remitente no es careers@rdztilegroup.net");
  const ar = primeraAuthResults(cabeceras);
  if (!ar) return no("sin Authentication-Results de Gmail");
  if (ar.authserv !== AUTHSERV_GMAIL) return no("la primera Authentication-Results no es la de Gmail: no se fía");
  const firmaDeEmpresa = (d: string) => d === DOMINIO_EMPRESA || d === "onmicrosoft.com" || d.endsWith(".onmicrosoft.com");
  if (!dkimPasaCon(ar.resultados, firmaDeEmpresa)) return no("la firma DKIM de la empresa no pasó en Gmail");
  return si("reenviado en lote por careers@: firma de la empresa válida");
}
