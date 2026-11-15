/**
 * Mensajes para la persona cuando Outlook no conecta. Sin imports de servidor: la tarjeta de Ajustes también los usa.
 */
/**
 * Mensaje para la persona, por clave. Las claves son las que viajan en la URL de vuelta a Ajustes (?outlook_error=…),
 * así no se mete texto libre en una URL.
 */
export const MENSAJES_OUTLOOK = {
  "faltan-variables": "Faltan variables de entorno para conectar Outlook (ver la lista en la tarjeta).",
  "sin-sesion": "Tu sesión caducó: entra de nuevo y vuelve a intentarlo.",
  "no-admin": "Solo un administrador puede conectar Outlook.",
  "estado-invalido": "La respuesta de Microsoft no coincide con el intento de conexión. Vuelve a empezar desde Ajustes.",
  cancelado: "Cancelaste la conexión en Microsoft. No se guardó nada.",
  "consentimiento-bloqueado":
    "Tu organización no deja que las cuentas conecten apps por sí solas. Un administrador de Microsoft 365 tiene que aprobar la app (Entra ID › Aplicaciones empresariales › Consentimiento de administrador) y después vuelves a conectar.",
  microsoft: "Microsoft rechazó la conexión. Inténtalo de nuevo; si sigue, avisa a quien administra la app.",
  correo: "Conectamos con Microsoft pero no pudimos leer la dirección del buzón. Inténtalo de nuevo.",
  guardar: "La conexión se autorizó, pero no se pudo guardar en la base. Inténtalo de nuevo.",
} as const;
export type ClaveErrorOutlook = keyof typeof MENSAJES_OUTLOOK;

