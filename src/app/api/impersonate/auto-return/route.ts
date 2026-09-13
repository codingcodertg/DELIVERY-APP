import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { apuntarImpersonacion } from "@/lib/impersonation-log";
import { EVENTO_VOLVER } from "@/lib/impersonation";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { revocarSesionImpersonada } from "@/lib/impersonation-revoke";

/**
 * La vuelta que nadie pulsa (D-248, al rebasar «entrar como» con el cierre de las 18:30).
 *
 * Hace lo mismo que `/api/impersonate/return`, pero por `GET` y terminando en una redirección,
 * porque quien la llama es **el middleware** y desde ahí solo se puede redirigir.
 *
 * Existe por dos caminos que antes acababan igual de mal:
 *
 *   · **El corte de las 18:30** pillando a un admin dentro de la sesión de un vendedor. Mandarlo
 *     al login **como el vendedor** es quedarse fuera de la propia cuenta por una regla que ni
 *     siquiera es suya.
 *   · **Los 60 minutos** cumpliéndose con la pestaña cerrada, donde el banner no puede actuar.
 *
 * En los dos, la salida buena es la misma que pulsando el botón: se le devuelve su sesión.
 *
 * Va por `/api/` a propósito — `skipsSession` la salta, así que el middleware no se mira a sí
 * mismo y no hay bucle. Y como todo lo que devuelve al admin, **falla hacia salir**: si no hay
 * cookie, está rota o el refresh ya no vale, se cierra sesión y al login. Lo que no puede pasar
 * es quedarse dentro de una identidad ajena.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const motivo = url.searchParams.get("motivo") === "expired" ? "expired" : "cutoff";

  const galletas = await cookies();
  const guardado = desempaquetar(galletas.get(COOKIE_RETORNO)?.value ?? null);
  const ssr = await createClient();

  // La cookie se borra siempre, y **aquí**, que es el final del camino: el middleware la dejó
  // intacta justo para que este momento tuviera de dónde restaurar.
  galletas.delete(COOKIE_RETORNO);

  const alLogin = () => NextResponse.redirect(new URL("/login", url.origin));

  if (!guardado) {
    await ssr.auth.signOut().catch(() => {});
    return alLogin();
  }

  // El token de la sesión impersonada, ANTES de restaurar (D-245): después la cookie ya es la
  // del admin y se revocaría la sesión que acaba de recuperar.
  const { data: { session: sesionAjena } } = await ssr.auth.getSession();

  const { error } = await ssr.auth.refreshSession({ refresh_token: guardado.refresh });
  if (error) {
    await ssr.auth.signOut().catch(() => {});
    return alLogin();
  }

  // La sesión del vendedor se cierra en el servidor, y solo esa (D-245). Aquí llega por el
  // corte de las 18:30 o por los 60 minutos, y en los dos casos la impersonación se acabó — que
  // la sesión ajena siguiera viva sería lo mismo que en la vuelta manual.
  //
  // **Con `await`, no soltada**: esto termina en un `redirect`, y en Vercel la función se puede
  // congelar al devolver la respuesta. Lo soltado tras responder no tiene garantía de correr, y
  // si no corriera no lo diría nadie.
  await revocarSesionImpersonada(sesionAjena?.access_token);

  await apuntarImpersonacion({
    actorId: guardado.adminId,
    targetId: guardado.comoId,
    targetName: null,
    kind: EVENTO_VOLVER,
    detail: `motivo: ${motivo} · ${Math.round((Date.now() - guardado.inicio) / 60_000)} min`,
  });

  // A la portada y no a donde iba: donde iba lo miraba como la otra persona, y ya no lo es.
  return NextResponse.redirect(new URL("/", url.origin));
}
