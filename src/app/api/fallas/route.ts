import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cabeEnElCuerpo, fallasDelCuerpo, normalizarFalla } from "@/lib/fallas/reglas";
import { anadirFallaDemo } from "@/lib/fallas/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/fallas: recibe las fallas del NAVEGADOR y las guarda con `registrar_falla`.
 *
 * Reglas (2026-11-25, revisión de seguridad):
 *  · Desde el navegador solo entra el origen «cliente». Cualquier otro origen se descarta: los del servidor solo
 *    llegan por `instrumentation.ts`.
 *  · Quién guarda lo decide la SESIÓN en el servidor: el usuario es `auth.getUser()` y el rol sale de `profiles`.
 *    Nada de eso se lee del cuerpo. Sin sesión, 204 y nada más.
 *  · La escritura va con la llave de servicio (`createAdminClient`): `registrar_falla` solo la puede ejecutar service_role.
 *  · El user agent sale de la cabecera de la petición, no del cuerpo.
 *  · Responde SIEMPRE 204 y no lanza: si la base no tiene la 352, si el cuerpo es grande o mal formado, o si algo falla.
 *    Esta ruta no reporta sus propios errores (no hay bucle).
 */
const SIN_CONTENIDO = () => new NextResponse(null, { status: 204 });
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const DEMO_USUARIO_ID = "00000000-0000-4000-8000-00000000000a";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const texto = await req.text();
    if (!cabeEnElCuerpo(texto)) return SIN_CONTENIDO();
    let cuerpo: unknown;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return SIN_CONTENIDO();
    }
    const fallas = fallasDelCuerpo(cuerpo);
    if (fallas.length === 0) return SIN_CONTENIDO();

    const navegador = req.headers.get("user-agent");
    if (LOCAL_MODE) {
      // El demo no tiene base ni sesión: las fallas se anotan en memoria, a nombre de la persona del demo.
      for (const crudo of fallas) {
        const falla = normalizarFalla(crudo, { rol: "admin", navegador, escritorio: false });
        if (falla && falla.origen === "cliente") anadirFallaDemo(falla, { id: DEMO_USUARIO_ID });
      }
      return SIN_CONTENIDO();
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return SIN_CONTENIDO();

    let rol: string | null = null;
    try {
      const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      rol = (perfil?.role as string | undefined) ?? null;
    } catch {
      rol = null;
    }

    const admin = createAdminClient();
    for (const crudo of fallas) {
      const escritorio = typeof crudo === "object" && crudo !== null && (crudo as { escritorio?: unknown }).escritorio === true;
      const falla = normalizarFalla(crudo, { rol, navegador, escritorio });
      // Del navegador, solo las de origen «cliente». Las demás se tiran sin contarlas.
      if (!falla || falla.origen !== "cliente") continue;
      const { error } = await admin.rpc("registrar_falla", {
        p_origen: falla.origen,
        p_app: falla.app,
        p_ruta: falla.ruta,
        p_mensaje: falla.mensaje,
        p_pila: falla.pila,
        p_componente: falla.componente,
        p_rol: rol,
        p_version: falla.version,
        p_navegador: falla.navegador,
        p_escritorio: falla.escritorio,
        p_huella: falla.huella,
        p_usuario: user.id,
      });
      // Sin la 352 la función no existe: se corta aquí, sin más intentos.
      if (error) break;
    }
  } catch {
    // Nunca se lanza desde aquí: quien reporta no debe enterarse de nada.
  }
  return SIN_CONTENIDO();
}
