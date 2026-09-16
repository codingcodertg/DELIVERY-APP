import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/api-auth";
import { validaCambioDeContrasena, type CodigoContrasena } from "@/lib/profile-password";

/**
 * Cambiar la propia contraseña, desde «Mi perfil» (D-NEXT). Es el único sitio que lo hace.
 *
 * **Pide la contraseña actual, y la comprueba aquí.** Una sesión abierta en un equipo ajeno —la
 * tienda, un teléfono prestado— no basta para quedarse con la cuenta. Y un admin que haya
 * entrado como otra persona tampoco puede cambiarle la contraseña, porque no la sabe.
 *
 * **Cómo se comprueba, y lo que se descartó:**
 *   · `reauthenticate()` manda un código por correo o SMS. Es un efecto fuera de esta máquina, y
 *     quien entra con usuario tiene una dirección inventada que no recibe nada.
 *   · `updateUser({ current_password })` solo lo exige el servidor si el proyecto tiene activado
 *     un ajuste que desde el repo no se ve. Si no lo tiene, se ignora y no protege nada.
 *   · `signInWithPassword` en el cliente de la propia sesión, que es lo que hacía el formulario de
 *     Entregas, **reemplaza la sesión de la persona** por una nueva. Con ella cambia su hora de
 *     inicio, que es justo lo que mira el cierre de las 18:30 (D-248).
 *
 * Así que se comprueba con **un cliente aislado, sin guardar sesión ni cookies**. Si la contraseña
 * vale, esa sesión de comprobación se cierra en el acto, solo esa (`scope: "local"`), y la
 * contraseña se cambia con la sesión de siempre, que no se toca.
 */
export async function POST(request: Request) {
  const puerta = await requireUser();
  if (!puerta.ok) return puerta.response;
  const { user, supabase } = puerta;

  const cuerpo = (await request.json().catch(() => null)) as { actual?: unknown; nueva?: unknown } | null;
  const actual = typeof cuerpo?.actual === "string" ? cuerpo.actual : "";
  const nueva = typeof cuerpo?.nueva === "string" ? cuerpo.nueva : "";

  const responde = (codigo: CodigoContrasena, status: number) => NextResponse.json({ ok: false, codigo }, { status });

  const invalido = validaCambioDeContrasena({ actual, nueva });
  if (invalido) return responde(invalido, 400);

  // Sin correo no hay con qué comprobar la contraseña actual. Toda cuenta del hub tiene uno —real
  // o inventado a partir del usuario—, así que esto no debería pasar; si pasa, no se cambia nada.
  if (!user.email) return responde("sin_correo", 400);

  const comprobacion = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await comprobacion.auth.signInWithPassword({ email: user.email, password: actual });
  // La contraseña tiene que ser la de ESTA cuenta: si el correo apuntara a otra, no vale.
  if (error || data.user?.id !== user.id) return responde("actual_incorrecta", 403);

  // La sesión de comprobación no se queda viva: se cierra ya, y solo ella.
  await comprobacion.auth.signOut({ scope: "local" }).catch(() => {});

  const { error: errorAlGuardar } = await supabase.auth.updateUser({ password: nueva });
  if (errorAlGuardar) return responde("no_guardada", 400);

  return NextResponse.json({ ok: true });
}
