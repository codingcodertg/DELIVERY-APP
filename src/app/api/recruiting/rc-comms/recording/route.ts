import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";

// ============================================================
// GET /api/recruiting/rc-comms/recording?id=<rc_comms.id> (solo admin): URL firmada de 10 minutos para escuchar la
// grabacion. El bucket `rc-recordings` es privado y no tiene politicas para los clientes, asi que la firma la hace el
// servidor con la llave de servicio, y solo despues de comprobar que quien pide es admin y que la fila es visible.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIGENCIA_SEG = 600;

export async function GET(req: Request) {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { data: fila, error } = await auth.supabase.schema("recruiting").from("rc_comms")
    .select("recording_path").eq("id", id).maybeSingle();
  if (error) return errorAlCliente("recruiting-rc-comms-recording", error, 503);
  if (!fila?.recording_path) return NextResponse.json({ error: "No recording" }, { status: 404 });

  const { data, error: eFirma } = await createAdminClient().storage.from("rc-recordings").createSignedUrl(fila.recording_path, VIGENCIA_SEG);
  if (eFirma || !data?.signedUrl) return errorAlCliente("recruiting-rc-comms-firma", eFirma ?? "sin URL", 503);
  return NextResponse.json({ url: data.signedUrl });
}
