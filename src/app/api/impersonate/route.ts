import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createSSRClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { adminKey } from "@/lib/erp/supabase/admin";
import { puedeEntrarComo, detalleDelRastro, EVENTO_ENTRAR } from "@/lib/impersonation";
import { apuntarImpersonacion } from "@/lib/impersonation-log";
import { AJUSTES_COOKIE, COOKIE_RETORNO, empaquetar } from "@/lib/impersonation-cookie";
import { impersonacionActiva } from "@/lib/impersonation-flag";

/**
 * Entrar como otra persona (D-NEXT).
 *
 * Crea en el navegador del admin una sesión **real** del usuario elegido: lo que ve a partir de
 * ahí es lo que vería esa persona, con su RLS. No es un disfraz de rol como «ver como».
 *
 * El orden de los pasos es la mitad del diseño, y no es el orden en que se escribiría solo:
 *
 *  1. La bandera. Si está apagada, esta ruta no existe (404, no 403: no se anuncia).
 *  2. Quién llama, de la cookie.
 *  3. Los dos roles, **de la base y con la llave de servicio**. Nunca de `user_metadata`, que
 *     la propia persona puede editarse desde el navegador.
 *  4. El permiso, en `puedeEntrarComo`, que es una función pura y probada.
 *  5. **Que el destino exista en Auth**, por id. Esto va antes de generar nada por una razón
 *     concreta: `generateLink` con `magiclink` **crea el usuario si el correo no existe**. Un
 *     dedazo no daría error, daría una cuenta fantasma en producción. Con `getUserById` primero,
 *     el correo que se le pasa es siempre el de una cuenta que acaba de confirmarse.
 *  6. El refresh token del admin, ANTES de tocar nada: en cuanto se canjee el enlace, la cookie
 *     de sesión será la del otro y ya no habrá de dónde sacarlo.
 *  7. **El rastro, y si no entra, aquí se acaba.** Sin fila no hay sesión.
 *  8. El enlace y su canje.
 *  9. La cookie de vuelta.
 */

export async function POST(request: Request) {
  // 1
  if (!impersonacionActiva()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const cuerpo = (await request.json().catch(() => null)) as { targetId?: unknown } | null;
  const targetId = typeof cuerpo?.targetId === "string" ? cuerpo.targetId.trim() : "";

  // 2
  const ssr = await createSSRClient();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return NextResponse.json({ error: "sin_sesion" }, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, adminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3 — los dos perfiles en una sola ida, y de la base.
  const { data: perfiles, error: errPerfiles } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .in("id", [user.id, targetId].filter(Boolean));
  if (errPerfiles) return NextResponse.json({ error: "perfiles" }, { status: 500 });

  const yo = perfiles?.find((p) => p.id === user.id);
  const destino = perfiles?.find((p) => p.id === targetId);

  // 4
  const veredicto = puedeEntrarComo(
    { id: user.id, rol: yo?.role },
    destino ? { id: destino.id, rol: destino.role } : null,
  );
  if (!veredicto.permitido) {
    // El motivo se devuelve para que la pantalla diga algo útil, pero el código es 403 en todos
    // los casos: quien no puede entrar tampoco necesita saber si el destino existe.
    return NextResponse.json({ error: veredicto.motivo }, { status: 403 });
  }

  // 5
  const { data: cuenta, error: errCuenta } = await admin.auth.admin.getUserById(targetId);
  const correo = cuenta?.user?.email?.trim();
  if (errCuenta || !cuenta?.user || !correo) {
    return NextResponse.json({ error: "sin_cuenta" }, { status: 404 });
  }

  // 6
  const { data: { session } } = await ssr.auth.getSession();
  const refresh = session?.refresh_token;
  if (!refresh) return NextResponse.json({ error: "sin_refresh" }, { status: 409 });

  // 7
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const apuntado = await apuntarImpersonacion({
    actorId: user.id,
    targetId,
    targetName: destino?.full_name ?? correo,
    kind: EVENTO_ENTRAR,
    detail: detalleDelRastro({ comoNombre: destino?.full_name ?? correo, desdeIp: ip }),
  });
  if (!apuntado) {
    return NextResponse.json({ error: "sin_rastro" }, { status: 503 });
  }

  // 8 — se genera y se canjea sin mandar ningún correo: `generateLink` devuelve el `hashed_token`
  // y el canje lo hace el servidor aquí mismo. (Que el proyecto no dispare además su propio SMTP
  // es lo único que no se ha podido comprobar desde la rama; va en la entrada.)
  const { data: enlace, error: errEnlace } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: correo,
  });
  const hash = enlace?.properties?.hashed_token;
  if (errEnlace || !hash) return NextResponse.json({ error: "sin_enlace" }, { status: 502 });

  const { error: errCanje } = await ssr.auth.verifyOtp({ type: "magiclink", token_hash: hash });
  if (errCanje) return NextResponse.json({ error: "sin_canje" }, { status: 502 });

  // 9
  const galletas = await cookies();
  galletas.set(COOKIE_RETORNO, empaquetar({
    refresh, adminId: user.id, comoId: targetId, inicio: Date.now(),
  }), AJUSTES_COOKIE);

  return NextResponse.json({ ok: true, comoNombre: destino?.full_name ?? correo });
}
