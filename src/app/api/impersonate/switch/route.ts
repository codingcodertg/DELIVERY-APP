import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { adminKey } from "@/lib/erp/supabase/admin";
import { puedeEntrarComo, detalleDelRastro, EVENTO_ENTRAR, EVENTO_VOLVER } from "@/lib/impersonation";
import { apuntarImpersonacion } from "@/lib/impersonation-log";
import { AJUSTES_COOKIE, COOKIE_RETORNO, desempaquetar, empaquetar } from "@/lib/impersonation-cookie";
import { impersonacionActiva } from "@/lib/impersonation-flag";
import { revocarSesionImpersonada } from "@/lib/impersonation-revoke";

/**
 * Saltar de un usuario a otro sin volver antes a la propia cuenta (D-307).
 *
 * El dueño: «si estoy en otro usuario ya con el switch, que siga la opción para seguir switcheando».
 *
 * Mientras se suplanta, la sesión **es** la de la otra persona (D-243). Por eso esta ruta no puede
 * hacer lo que hace `/api/impersonate` con la sesión que llega: su paso 6 toma el refresh token de la
 * sesión actual, y aquí la sesión actual es la del vendedor — la cookie de vuelta acabaría llevando a
 * él, y el admin no podría volver. Hoy eso lo para el 403 de `puedeEntrarComo` por accidente (el rol
 * que se lee es el del vendedor); esta ruta lo hace por diseño:
 *
 *  1. La bandera, como en entrar.
 *  2. La cookie de retorno. Sin ella no es un salto: 409.
 *  3. El token de la sesión ajena, ANTES de restaurar (después ya no está; D-245).
 *  4. **Se restaura al admin** con el refresh de la cookie. Si no vale, salida como en `return`: cookie
 *     fuera, sesión local cerrada, al login. **Todo lo que sigue se decide con la sesión restaurada.**
 *  5. Quién es el admin: **de la sesión restaurada, no de la cookie**. La cookie no decide quién es admin.
 *  6. Los dos roles de la base con la llave de servicio, y `puedeEntrarComo` con ese id.
 *  7. Se cierra la sesión del anterior, solo esa, y se apunta su fin diciendo que fue un salto.
 *  8. A partir de aquí, cualquier fallo deja «admin restaurado, banner fuera», y la respuesta lo dice
 *     (`salida: "admin"`) para que la pantalla recargue en vez de quedarse con el banner pintado.
 *  9. El rastro del nuevo —sin fila no hay sesión—, el enlace y su canje.
 * 10. La cookie, **solo al final** y con el refresh **rotado** que devolvió la restauración (Supabase
 *     rota los refresh tokens al usarlos), el admin de esa sesión, y el `inicio` **original**: el tope
 *     de 60 minutos es un límite de seguridad (D-245), y saltar no lo estira.
 */
export async function POST(request: Request) {
  // 1
  if (!impersonacionActiva()) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const cuerpo = (await request.json().catch(() => null)) as { targetId?: unknown } | null;
  const targetId = typeof cuerpo?.targetId === "string" ? cuerpo.targetId.trim() : "";

  // 2
  const galletas = await cookies();
  const guardado = desempaquetar(galletas.get(COOKIE_RETORNO)?.value ?? null);
  if (!guardado) return NextResponse.json({ error: "sin_impersonacion" }, { status: 409 });

  const ssr = await createSSRClient();

  // 3
  const { data: { session: sesionAjena } } = await ssr.auth.getSession();

  // 4 — la cookie vieja deja de valer pase lo que pase: o se reescribe al final o se borra aquí.
  galletas.delete(COOKIE_RETORNO);
  const { data: restaurada, error: errRefresh } = await ssr.auth.refreshSession({ refresh_token: guardado.refresh });
  const sesionAdmin = restaurada?.session;
  if (errRefresh || !sesionAdmin?.user?.id || !sesionAdmin.refresh_token) {
    await ssr.auth.signOut({ scope: "local" }).catch(() => {});
    return NextResponse.json({ ok: false, salida: "login" }, { status: 401 });
  }

  // 5
  const adminId = sesionAdmin.user.id;
  const minutos = Math.round((Date.now() - guardado.inicio) / 60_000);

  /** Desde aquí el admin ya está restaurado: cualquier salida deja su sesión y quita el banner. */
  const conAdminRestaurado = async (cuerpo: Record<string, unknown>, status: number) => {
    await revocarSesionImpersonada(sesionAjena?.access_token);
    await apuntarImpersonacion({
      actorId: adminId, targetId: guardado.comoId, targetName: null, kind: EVENTO_VOLVER,
      detail: `motivo: switch-fallido · ${minutos} min`,
    });
    return NextResponse.json({ ...cuerpo, salida: "admin" }, { status });
  };

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 6
  const { data: perfiles, error: errPerfiles } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .in("id", [adminId, guardado.comoId, targetId].filter(Boolean));
  if (errPerfiles) return conAdminRestaurado({ error: "perfiles" }, 500);
  const yo = perfiles?.find((p) => p.id === adminId);
  const anterior = perfiles?.find((p) => p.id === guardado.comoId);
  const destino = perfiles?.find((p) => p.id === targetId);

  const veredicto = puedeEntrarComo({ id: adminId, rol: yo?.role }, destino ? { id: destino.id, rol: destino.role } : null);
  if (!veredicto.permitido) return conAdminRestaurado({ error: veredicto.motivo }, 403);

  // 7 — el anterior se cierra y se apunta su fin: fue un salto, no una vuelta.
  await revocarSesionImpersonada(sesionAjena?.access_token);
  await apuntarImpersonacion({
    actorId: adminId, targetId: guardado.comoId, targetName: anterior?.full_name ?? null, kind: EVENTO_VOLVER,
    detail: `motivo: switch · ${minutos} min`,
  });

  /** Ya cerrado el anterior: un fallo de aquí en adelante deja al admin en su cuenta, sin repetir el cierre. */
  const yaRestaurado = (cuerpo: Record<string, unknown>, status: number) =>
    NextResponse.json({ ...cuerpo, salida: "admin" }, { status });

  // 8/9
  const { data: cuenta, error: errCuenta } = await admin.auth.admin.getUserById(targetId);
  const correo = cuenta?.user?.email?.trim();
  if (errCuenta || !cuenta?.user || !correo) return yaRestaurado({ error: "sin_cuenta" }, 404);

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const nombreNuevo = destino?.full_name ?? correo;
  const apuntado = await apuntarImpersonacion({
    actorId: adminId, targetId, targetName: nombreNuevo, kind: EVENTO_ENTRAR,
    detail: `${detalleDelRastro({ comoNombre: nombreNuevo, desdeIp: ip })} · desde: ${anterior?.full_name ?? guardado.comoId}`,
  });
  if (!apuntado) return yaRestaurado({ error: "sin_rastro" }, 503);

  const { data: enlace, error: errEnlace } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  const hash = enlace?.properties?.hashed_token;
  if (errEnlace || !hash) return yaRestaurado({ error: "sin_enlace" }, 502);

  const { error: errCanje } = await ssr.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (errCanje) return yaRestaurado({ error: "sin_canje" }, 502);

  // 10
  galletas.set(COOKIE_RETORNO, empaquetar({
    refresh: sesionAdmin.refresh_token, adminId, comoId: targetId, inicio: guardado.inicio,
  }), AJUSTES_COOKIE);

  return NextResponse.json({ ok: true, comoNombre: nombreNuevo });
}
