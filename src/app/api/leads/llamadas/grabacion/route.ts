import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================
// GET /api/leads/llamadas/grabacion?lead=<lead>&id=<rc_lead_calls.id>: URL firmada de 10 minutos para escuchar la
// grabación de una llamada de un lead. El bucket `rc-lead-recordings` es privado: la firma la hace el servidor con la
// llave de servicio, y solo después de que `leads_llamadas_de_lead` (con la sesión de quien pide) diga que esa llamada
// es de un teléfono de un lead que esa persona VE. Sin sesión, o sin ver el lead, no sale nada.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIGENCIA_SEG = 600;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const lead = params.get("lead") ?? "";
  const id = params.get("id") ?? "";
  if (!UUID.test(lead) || !UUID.test(id)) return NextResponse.json({ error: "lead and id required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: llamadas, error } = await supabase.rpc("leads_llamadas_de_lead", { p_lead: lead });
  if (error) {
    // 42501 (sin módulo) y P0002 (no ve el lead) se responden igual que una llamada que no existe.
    if (error.code === "42501" || error.code === "P0002") return NextResponse.json({ error: "not found" }, { status: 404 });
    return errorAlCliente("leads-llamadas-grabacion", error, 503);
  }
  const visible = ((llamadas ?? []) as { id: string; has_recording: boolean }[]).find((c) => c.id === id);
  if (!visible?.has_recording) return NextResponse.json({ error: "No recording" }, { status: 404 });

  const admin = createAdminClient();
  const { data: fila, error: eFila } = await admin.from("rc_lead_calls").select("recording_path").eq("id", id).maybeSingle();
  if (eFila) return errorAlCliente("leads-llamadas-grabacion-fila", eFila, 503);
  if (!fila?.recording_path) return NextResponse.json({ error: "No recording" }, { status: 404 });

  const { data, error: eFirma } = await admin.storage.from("rc-lead-recordings").createSignedUrl(fila.recording_path as string, VIGENCIA_SEG);
  if (eFirma || !data?.signedUrl) return errorAlCliente("leads-llamadas-grabacion-firma", eFirma ?? "sin URL", 503);
  return NextResponse.json({ url: data.signedUrl });
}
