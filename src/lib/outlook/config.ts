/**
 * Constantes y variables de entorno de Indeed por correo. Puro: no lee nada por su cuenta (recibe el entorno), así se
 * puede probar y la tarjeta de Ajustes puede decir qué falta sin tocar secretos.
 */
import { claveDesdeTexto } from "./cifrado";

/** Las cuatro variables que tienen que existir. Solo se muestran por NOMBRE, nunca con su valor. */
export const VARIABLES_OUTLOOK = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "OUTLOOK_TOKEN_KEY"] as const;

/** Permisos DELEGADOS. Sin permisos de aplicación, sin consentimiento de administrador, sin políticas de Exchange. */
export const SCOPES_OUTLOOK = "offline_access User.Read Mail.Read";

/** Dominios desde los que Indeed manda los avisos de candidatos. Un remitente cuyo dominio esté aquí cuenta como Indeed. */
export const DOMINIOS_INDEED = ["indeed.com", "indeedemail.com", "indeedmail.com"] as const;

/** Como mucho este número de correos por corrida (cron o «Revisar ahora»). El resto se queda para la siguiente. */
export const MAX_MENSAJES_POR_CORRIDA = 50;

/** Un CV más grande que esto no se guarda; el correo queda como «omitido» con el motivo. */
export const MAX_CV_BYTES = 10 * 1024 * 1024;

/** Margen hacia atrás desde el cursor en cada corrida: cubre correos con la misma hora o que llegaron tarde a Graph. */
export const MARGEN_CURSOR_MS = 30 * 60 * 1000;

/** Primera corrida (o primera tras conectar): cuántas horas hacia atrás mirar. No se importa historial antiguo. */
export const VENTANA_INICIAL_MS = 24 * 60 * 60 * 1000;

/** Los nombres de las variables que faltan o son inválidas (la llave de cifrado se valida de verdad). */
export function variablesQueFaltan(env: Record<string, string | undefined> = process.env): string[] {
  const faltan: string[] = [];
  for (const nombre of VARIABLES_OUTLOOK) {
    if (nombre === "OUTLOOK_TOKEN_KEY") {
      if (!claveDesdeTexto(env[nombre])) faltan.push(nombre);
    } else if (!(env[nombre] ?? "").trim()) {
      faltan.push(nombre);
    }
  }
  return faltan;
}
