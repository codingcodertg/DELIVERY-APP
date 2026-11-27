import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { huellaDeFalla } from "@/lib/fallas/reglas";
import { MAX_CUERPO_CSP, mensajeDeViolacion, violacionesDelCuerpo } from "@/lib/csp-reporte";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/csp-report (D-1206): el navegador manda aquí las violaciones del CSP en modo Report-Only.
 *
 *  · Sin sesión: el navegador manda los reportes por su cuenta, a veces sin cookies. No se lee nada del usuario.
 *  · Se guarda solo directiva + host bloqueado + ruta de la página (sin query): nada personal.
 *  · Va por `registrar_falla` (352) con origen «cliente», que tiene su propio freno por hora; lo de más se descarta.
 *  · Responde SIEMPRE 204 y no lanza: un reporte mal formado o la base caída no dan error ni bucle.
 */
const NADA = () => new NextResponse(null, { status: 204 });

export async function POST(req: Request): Promise<NextResponse> {
  try {
    if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") return NADA();
    const crudo = await req.text();
    if (!crudo || crudo.length > MAX_CUERPO_CSP) return NADA();
    let cuerpo: unknown;
    try { cuerpo = JSON.parse(crudo); } catch { return NADA(); }
    const vistas = new Set<string>();
    const admin = createAdminClient();
    for (const v of violacionesDelCuerpo(cuerpo)) {
      const mensaje = mensajeDeViolacion(v);
      if (vistas.has(mensaje)) continue;
      vistas.add(mensaje);
      await admin.rpc("registrar_falla", {
        p_origen: "cliente", p_app: "csp", p_ruta: v.pagina, p_mensaje: mensaje, p_pila: null, p_componente: null,
        p_rol: null, p_version: null, p_navegador: req.headers.get("user-agent"), p_escritorio: false,
        p_huella: huellaDeFalla({ origen: "cliente", ruta: "csp", mensaje }),
      });
    }
  } catch { /* nunca falla hacia el navegador */ }
  return NADA();
}
