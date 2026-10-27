// ============================================================
// Dar de baja libera el correo (D-NEXT)
//
// Al dar de baja a alguien con cuenta, su correo y su usuario quedan libres para dárselos a
// otra persona. La cuenta NO se borra (el perfil y su historial se quedan): se le cambia el
// correo a un alias archivado y se le quita el usuario.
//
// El alias es `<id-de-la-cuenta>@baja.users.rdztilegroup.net`:
//  - el id es el UUID de la cuenta, único, así que dos alias no chocan nunca;
//  - el dominio es un SUBDOMINIO del de las direcciones sintéticas: no tiene buzón, y ningún
//    nombre de usuario puede derivar a él (los usuarios derivan a `@users.rdztilegroup.net`),
//    así que nadie puede entrar tecleando un usuario;
//  - no lleva nada del correo original: un `+alias` en el dominio de verdad SÍ entregaría
//    correo al buzón original.
// Lo que tenía se guarda en `app_metadata.credenciales_liberadas` de Auth (solo lo escribe el
// servicio) y, si hay expediente, en la nota de la baja.
// ============================================================

// Literal, sin importar `INTERNAL_EMAIL_DOMAIN`: así el guion de una vez (scripts/libera-credenciales-de-bajas.mjs)
// importa ESTE fichero con node y no una copia. La prueba fija que es el subdominio de aquel.
export const DOMINIO_BAJA = "baja.users.rdztilegroup.net";

/** El correo archivado de una cuenta dada de baja. Determinista: el mismo id da el mismo alias. */
export function aliasDeBaja(profileId: string): string {
  const id = (profileId ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!id) throw new Error("aliasDeBaja: falta el id de la cuenta");
  return `${id}@${DOMINIO_BAJA}`;
}

export function esAliasDeBaja(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase().endsWith(`@${DOMINIO_BAJA}`);
}

export type CredencialesLiberadas = { email: string | null; username: string | null; at: string };

/** Lo que se guarda en Auth. Un correo que ya es alias no se guarda como «lo que tenía». */
export function credencialesAGuardar(
  d: { email: string | null | undefined; username: string | null | undefined },
  ahora: Date = new Date(),
): CredencialesLiberadas {
  const email = (d.email ?? "").trim();
  return {
    email: email && !esAliasDeBaja(email) ? email : null,
    username: (d.username ?? "").trim() || null,
    at: ahora.toISOString(),
  };
}

/** ¿Queda algo por liberar? Sí si el correo no es todavía el alias, o si aún tiene usuario. */
export function hayQueLiberar(d: { email: string | null | undefined; username: string | null | undefined }): boolean {
  return !esAliasDeBaja(d.email) || !!(d.username ?? "").trim();
}

/** La línea que se añade a la nota de la baja, para que RR. HH. vea lo que tenía. */
export function lineaDeNota(c: CredencialesLiberadas): string {
  const partes: string[] = [];
  if (c.email) partes.push(`email ${c.email}`);
  if (c.username) partes.push(`usuario ${c.username}`);
  return partes.length ? `[Credenciales liberadas: ${partes.join(", ")}]` : "";
}

/** Añade la línea a la nota sin duplicarla. */
export function notaConCredenciales(nota: string | null | undefined, c: CredencialesLiberadas): string | null {
  const linea = lineaDeNota(c);
  const base = (nota ?? "").trim();
  if (!linea || base.includes(linea)) return base || null;
  return base ? `${base}\n${linea}` : linea;
}
