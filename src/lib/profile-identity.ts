import { INTERNAL_EMAIL_DOMAIN, isSyntheticEmail } from "@/lib/username";

/**
 * Con qué entra esta persona, para enseñárselo en «Mi perfil» (D-NEXT).
 *
 * Quien no tiene correo entra con un usuario, y su «correo» es una dirección inventada que no
 * recibe nada (`lib/username.ts`). Enseñar esa dirección como su correo sería mentir: se enseña
 * el usuario. Es la misma regla que `/api/user-identity`, que tampoco la devuelve como correo.
 */
export function identidadVisible(a: {
  email: string | null | undefined;
  username: string | null | undefined;
}): { correo: string | null; usuario: string | null } {
  const email = (a.email ?? "").trim();
  const sintetico = isSyntheticEmail(email);
  const guardado = (a.username ?? "").trim();
  // Sin usuario guardado pero con dirección inventada, el usuario ES su parte local.
  const deLaDireccion = sintetico ? email.slice(0, -(`@${INTERNAL_EMAIL_DOMAIN}`.length)) : "";
  return {
    correo: email && !sintetico ? email : null,
    usuario: guardado || deLaDireccion || null,
  };
}
