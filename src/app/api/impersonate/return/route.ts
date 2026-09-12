import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { apuntarImpersonacion } from "@/lib/impersonation-log";
import { EVENTO_VOLVER } from "@/lib/impersonation";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { revocarSesionImpersonada } from "@/lib/impersonation-revoke";

/**
 * Volver a mi cuenta (D-243).
 *
 * **Esta ruta no puede fallar hacia «te quedas como Patricia».** Es la única promesa dura de
 * todo el encargo, y por eso está escrita al revés que la de entrar: allí cualquier duda aborta,
 * y aquí cualquier duda **sale igual** — si la cookie no está, está rota, o el refresh token ya
 * no vale, se cierra la sesión y se manda al login normal. Peor que pedir una contraseña es
 * quedarse dentro de la identidad de otra persona sin salida.
 *
 * Y **no está detrás de la bandera**. Si alguien apaga `IMPERSONATION_ENABLED` mientras hay una
 * sesión impersonada viva, quien esté dentro tiene que poder salir; una bandera que atrapa a la
 * gente al apagarse no es un freno, es una trampa.
 *
 * El rastro del regreso se escribe con `apuntarImpersonacion`, pero aquí **un fallo al escribir
 * no detiene nada**: al entrar, sin fila no hay sesión porque todavía no se había creado; al
 * volver, la sesión ajena ya existe y negarse a cerrarla por no poder escribir una línea sería
 * exactamente el fallo que esta ruta existe para no tener.
 */

/** Por qué se vuelve. Va al detalle de la fila para que el registro cuente la historia entera. */
export type MotivoVuelta = "manual" | "expired" | "cutoff";

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => null)) as { motivo?: unknown } | null;
  const motivo: MotivoVuelta =
    cuerpo?.motivo === "expired" || cuerpo?.motivo === "cutoff" ? cuerpo.motivo : "manual";

  const galletas = await cookies();
  const guardado = desempaquetar(galletas.get(COOKIE_RETORNO)?.value ?? null);
  const ssr = await createSSRClient();

  // La cookie se borra SIEMPRE, pase lo que pase después. Una cookie de retorno que sobrevive es
  // una llave a una cuenta de admin esperando en un equipo compartido.
  galletas.delete(COOKIE_RETORNO);

  if (!guardado) {
    // No había vuelta: se sale del todo. No se deja a nadie dentro de una identidad ajena.
    await ssr.auth.signOut().catch(() => {});
    return NextResponse.json({ ok: false, salida: "login" });
  }

  // `refreshSession({ refresh_token })` y NO `setSession({ access_token: "", refresh_token })`,
  // que fue mi primera versión y **fallaba siempre**: medido en `@supabase/auth-js` 2.112.4,
  // `_setSession` lanza `AuthSessionMissingError` si el `access_token` viene vacío, y esa
  // comprobación va antes de mirar el refresh token. O sea que la única promesa dura de esta
  // rama —devolver al admin sin contraseña— no se cumplía ni una vez, y la fila de «fin» no se
  // escribía nunca porque el error salía antes. Nadie lo habría visto hasta producción: se sale
  // igual, solo que al login.
  // El token de la sesión impersonada, ANTES de restaurar: después la cookie ya es del admin y
  // no habría de dónde sacarlo (D-245).
  const { data: { session: sesionAjena } } = await ssr.auth.getSession();

  const { error } = await ssr.auth.refreshSession({ refresh_token: guardado.refresh });

  if (error) {
    // El refresh token del admin ya no vale (caducó, o cerró sesión en otro sitio). Misma
    // salida: fuera, y a poner la contraseña.
    await ssr.auth.signOut().catch(() => {});
    return NextResponse.json({ ok: false, salida: "login" });
  }

  // Y se cierra en el servidor la sesión del vendedor, solo esa.
  //
  // **Se espera, no se suelta con `void`** (D-245). Esto corre en Vercel, donde la función se
  // puede congelar en cuanto devuelve la respuesta: el trabajo lanzado después no tiene ninguna
  // garantía de correr, y no hay en este repo ni un `after()` ni un `waitUntil` que digan lo
  // contrario. Soltarlo dejaba **el propósito entero de esto** dependiendo de que la plataforma
  // fuera amable, y si no corriera no lo diría nadie. Lo mismo valía para la fila de fin de
  // D-243, que llevaba `void` desde el principio.
  //
  // «No bloquea» se conserva entera, y no depende del `void`: las dos funciones capturan todo y
  // devuelven `false`, nunca lanzan. Un fallo no cambia la respuesta — solo la hace esperar dos
  // peticiones cortas.
  await revocarSesionImpersonada(sesionAjena?.access_token);

  await apuntarImpersonacion({
    actorId: guardado.adminId,
    targetId: guardado.comoId,
    targetName: null,
    kind: EVENTO_VOLVER,
    detail: `motivo: ${motivo} · ${Math.round((Date.now() - guardado.inicio) / 60_000)} min`,
  });

  return NextResponse.json({ ok: true, salida: "admin" });
}
