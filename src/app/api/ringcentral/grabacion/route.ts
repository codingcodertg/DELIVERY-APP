import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";

// ============================================================
// GET /api/ringcentral/grabacion?id=<rc_driver_calls.id> (solo admin): URL firmada de 10 minutos para escuchar una
// grabación de chofer. El bucket `rc-driver-recordings` es privado y no tiene políticas para los clientes: la firma la
// hace el servidor con la llave de servicio, y solo después de comprobar que quien pide es admin y que la fila es visible
// para él (RLS con su sesión).
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIGENCIA_SEG = 600;

export async function GET(req: Request) {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: fila, error } = await auth.supabase.from("rc_driver_calls").select("recording_path").eq("id", id).maybeSingle();
  if (error) return errorAlCliente("ringcentral-choferes-grabacion", error, 503);
  if (!fila?.recording_path) return NextResponse.json({ error: "No recording" }, { status: 404 });

  const { data, error: eFirma } = await createAdminClient().storage
    .from("rc-driver-recordings").createSignedUrl(fila.recording_path as string, VIGENCIA_SEG);
  if (eFirma || !data?.signedUrl) return errorAlCliente("ringcentral-choferes-firma", eFirma ?? "sin URL", 503);
  return NextResponse.json({ url: data.signedUrl });
}
