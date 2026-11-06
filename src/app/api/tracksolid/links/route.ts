import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEnlazarCamiones } from "@/lib/tracksolid/camiones";
import { enlaceValido } from "@/lib/tracksolid/servicio";

// ============================================================
// PUT /api/tracksolid/links — enlaza un rastreador (IMEI) con un chofer y/o su tienda base (D-NEXT).
//
// Solo el admin, desde Ajustes. Escribe en `tracksolid_devices` (257) con la llave de servicio: la tabla no
// tiene políticas. NO toca nada en la cuenta de TrackSolid: el enlace vive solo en esta app.
// Sin chofer ni tienda, el enlace se borra y el camión vuelve a salir con su nombre de TrackSolid.
// ============================================================

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data: yo, error } = await auth.supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not check your access." }, { status: 503 });
  if (!puedeEnlazarCamiones(yo)) return NextResponse.json({ error: "Only an admin can link trackers." }, { status: 403 });

  const v = enlaceValido(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  let db;
  try { db = createAdminClient(); } catch { return NextResponse.json({ error: "Not available on this installation." }, { status: 503 }); }

  if (v.enlace.driver_id) {
    const { data: chofer } = await db.from("profiles").select("id").eq("id", v.enlace.driver_id).eq("role", "driver").maybeSingle();
    if (!chofer) return NextResponse.json({ error: "That driver does not exist." }, { status: 400 });
  }

  const res = !v.enlace.driver_id && !v.enlace.home_store
    ? await db.from("tracksolid_devices").delete().eq("imei", v.enlace.imei)
    : await db.from("tracksolid_devices").upsert({ ...v.enlace, device_name: v.nombre, updated_at: new Date().toISOString(), updated_by: auth.user.id }, { onConflict: "imei" });
  if (res.error) return NextResponse.json({ error: "Could not save the link." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
