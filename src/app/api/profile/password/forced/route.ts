import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/api-auth";
import { codigoDeFalloAlGuardar } from "@/lib/profile-password";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import { logSecurity } from "@/lib/security-log-server";
import { debeCambiarContrasena, QUITAR_MARCA, validaNuevaObligatoria } from "@/lib/cambio-obligatorio";

/**
 * Cambiar la contraseña temporal al entrar (D-NEXT). La llama solo la pantalla `/change-password`.
 *
 * **Sin pedir la actual, y por eso solo con la marca.** «Mi perfil» (`/api/profile/password`, D-265)
 * pide la actual para que una sesión abierta en un teléfono ajeno no baste para quedarse con la
 * cuenta. Aquí la actual es la temporal que dio la oficina, la persona acaba de escribirla para
 * entrar, y pedírsela otra vez no protege nada. Pero eso vale SOLO mientras la cuenta lleva la
 * marca: sin ella, esta ruta no cambia nada (409) y el único camino sigue siendo «Mi perfil».
 *
 * **Ni dentro de «Entrar como» (D-243).** El admin que entra como un chofer no elige su contraseña:
 * el middleware le deja pasar con un aviso, y esta ruta se niega aunque alguien la llame a mano.
 *
 * La contraseña y la marca van en **la misma llamada** a `updateUser`: o cambian las dos o ninguna.
 * Separadas, un fallo entre una y otra dejaría a alguien con contraseña nueva y obligado a cambiarla
 * otra vez, o —peor— sin la marca y con `tracker`. `data` se FUSIONA con lo que ya hay en
 * `user_metadata` (GoTrue, `UpdateUserMetaData`): el resto de la ficha no se toca.
 */
export async function POST(request: Request) {
  const puerta = await requireUser();
  if (!puerta.ok) return puerta.response;
  const { user, supabase } = puerta;

  if (desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null)) {
    return NextResponse.json({ ok: false, codigo: "suplantando" }, { status: 403 });
  }
  if (!debeCambiarContrasena(user)) {
    return NextResponse.json({ ok: false, codigo: "no_hace_falta" }, { status: 409 });
  }

  const cuerpo = (await request.json().catch(() => null)) as { nueva?: unknown } | null;
  const nueva = typeof cuerpo?.nueva === "string" ? cuerpo.nueva : "";
  const invalido = validaNuevaObligatoria({ nueva });
  if (invalido) return NextResponse.json({ ok: false, codigo: invalido }, { status: 400 });

  const { error } = await supabase.auth.updateUser({ password: nueva, data: QUITAR_MARCA });
  if (error) {
    const fallo = codigoDeFalloAlGuardar(error);
    if (fallo.codigo === "no_guardada") {
      const e = error as { code?: unknown; status?: unknown; message?: unknown };
      console.error("[profile/password/forced] Supabase no guardó la contraseña", { code: e.code, status: e.status, message: e.message });
    }
    return NextResponse.json({ ok: false, codigo: fallo.codigo, ...(fallo.motivos ? { motivos: fallo.motivos } : {}) }, { status: 400 });
  }

  // Que quede que la temporal se cambió, y quién: la propia persona. Nunca la contraseña.
  const { data: perfil } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  await logSecurity({
    actorId: user.id,
    targetId: user.id,
    targetName: (perfil as { full_name?: string | null } | null)?.full_name ?? null,
    kind: "password_changed",
    detail: "Temporary password replaced at sign-in · Contraseña temporal cambiada al entrar",
  });

  return NextResponse.json({ ok: true });
}
