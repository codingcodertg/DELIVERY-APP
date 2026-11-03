import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { dispositivoDeLaPeticion, tipoPorAgente } from "@/lib/security/reglas";
import { lugarDeLaPeticion } from "@/lib/security/lugar";

export const runtime = "nodejs";

/**
 * «Este dispositivo acaba de usarse» (D-811). Lo manda `IdentidadDelDispositivo` al cargar y cada diez minutos. Con la
 * sesión de quien entra: `security_touch_device` (229) escribe solo lo que esa sesión puede saber de sí misma —su id de
 * dispositivo, su agente, su hora— y un dispositivo nuevo nace pendiente. Aquí no se decide nada.
 *
 * El id y el tipo NO se creen del cuerpo: salen de la petición. La cabecera `x-rtg-device` solo la pone la app de
 * escritorio (ligada a la máquina: `desktop`, `bound`); sin ella, la cookie, y el tipo por el agente (teléfono o
 * navegador). Un navegador que se disfrace de app en el agente sigue siendo «browser»: sin cabecera no hay escritorio.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const d = dispositivoDeLaPeticion({ cabecera: req.headers.get("x-rtg-device"), cookie: req.headers.get("cookie") });
  if (!d) return NextResponse.json({ error: "No device id." }, { status: 400 });
  const ua = req.headers.get("user-agent") ?? "";
  const kind = d.ligado ? "desktop" : tipoPorAgente(ua) === "phone" ? "phone" : "browser";
  // D-822 (234): y desde dónde: la IP y la ciudad que Vercel deduce de ella.
  const { ip, lugar } = lugarDeLaPeticion(req.headers);
  const { error } = await auth.supabase.rpc("security_touch_device", { p_device: d.id, p_user_agent: ua, p_kind: kind, p_bound: d.ligado, p_ip: ip, p_place: lugar });
  // Sin la 229 aplicada la función no existe: no es un fallo de quien navega.
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 200 });
  return NextResponse.json({ ok: true });
}
