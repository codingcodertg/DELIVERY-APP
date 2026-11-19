import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";
import { choferesDeLaSolicitud } from "@/lib/ringcentral-choferes/choferes";

// ============================================================
// PUT /api/ringcentral/choferes (solo admin): guarda la lista de extensiones que son choferes. Lo que llega es la lista
// completa: las que están se marcan activas (y se actualiza su número y nombre), y las que estaban y ya no llegan se
// desmarcan (`active = false`, no se borran: sus llamadas se conservan). Va con la sesión del admin; la RLS de
// `rc_driver_extensions` (solo admin) es la segunda puerta.
// ============================================================

export async function PUT(req: Request) {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const lista = choferesDeLaSolicitud(cuerpo);
  if (!lista) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const sb = auth.supabase;
  const { data: { user } } = await sb.auth.getUser();
  const ahora = new Date().toISOString();

  const { data: existentes, error: eExistentes } = await sb.from("rc_driver_extensions").select("rc_extension_id");
  if (eExistentes) return errorAlCliente("ringcentral-choferes-leer", eExistentes, 503);
  const conocidas = new Set((existentes ?? []).map((e) => e.rc_extension_id as string));

  if (lista.length) {
    const filas = lista.map((c) => ({
      rc_extension_id: c.id,
      extension_number: c.numero,
      name: c.nombre,
      active: true,
      updated_at: ahora,
      // Quién la agregó: solo en la primera vez. Las siguientes solo cambian nombre y número.
      ...(conocidas.has(c.id) ? {} : { added_by: user?.id ?? null, added_at: ahora }),
    }));
    const { error } = await sb.from("rc_driver_extensions").upsert(filas, { onConflict: "rc_extension_id" });
    if (error) return errorAlCliente("ringcentral-choferes-guardar", error, 503);
  }

  // Las que ya no están en la lista dejan de ser choferes. Los ids ya pasaron la validación (sin comas ni paréntesis).
  let quitar = sb.from("rc_driver_extensions").update({ active: false, updated_at: ahora }).eq("active", true);
  if (lista.length) quitar = quitar.not("rc_extension_id", "in", `(${lista.map((c) => c.id).join(",")})`);
  const { error: eQuitar } = await quitar;
  if (eQuitar) return errorAlCliente("ringcentral-choferes-quitar", eQuitar, 503);

  return NextResponse.json({ ok: true, choferes: lista.length });
}
