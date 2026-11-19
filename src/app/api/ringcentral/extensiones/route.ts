import { NextResponse } from "next/server";
import { RC_SERVER, ringcentralToken } from "@/lib/ringcentral";
import { errorAlCliente } from "@/lib/api-error";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";
import { credencialesDeLaSincronizacion } from "@/lib/ringcentral-choferes/credenciales";
import { extensionesDeLaRespuesta } from "@/lib/ringcentral-choferes/choferes";

// ============================================================
// GET /api/ringcentral/extensiones (solo admin): las extensiones de usuario de la cuenta de RingCentral, con la marca
// de cuáles son choferes hoy. Es la lista de la pestaña «Choferes». Solo lee de RingCentral.
// ============================================================

export async function GET() {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  const credenciales = credencialesDeLaSincronizacion();
  if (!credenciales) return NextResponse.json({ error: "RingCentral is not configured." }, { status: 503 });

  let extensiones;
  try {
    const token = await ringcentralToken(credenciales);
    const res = await fetch(`${RC_SERVER}/restapi/v1.0/account/~/extension?perPage=500&status=Enabled`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return errorAlCliente("ringcentral-extensiones", `RingCentral ${res.status}`, 502, "RingCentral did not answer. Try again.");
    const data = await res.json();
    extensiones = extensionesDeLaRespuesta((data?.records ?? []) as unknown[]);
  } catch (e) {
    return errorAlCliente("ringcentral-extensiones", e, 502, "RingCentral did not answer. Try again.");
  }

  const { data: choferes, error } = await auth.supabase.from("rc_driver_extensions").select("rc_extension_id").eq("active", true);
  if (error) return errorAlCliente("ringcentral-extensiones-choferes", error, 503);
  const marcadas = new Set((choferes ?? []).map((c) => c.rc_extension_id as string));

  return NextResponse.json({
    extensiones: extensiones
      .sort((a, b) => a.numero.localeCompare(b.numero, "en", { numeric: true }))
      .map((e) => ({ ...e, esChofer: marcadas.has(e.id) })),
  });
}
