import { NextResponse } from "next/server";
import { errorAlCliente } from "@/lib/api-error";
import { requireAdminDeRc } from "@/lib/recruiting/rc-comms-acceso";

// ============================================================
// GET /api/recruiting/rc-comms?candidate=<id> (solo admin): las llamadas y los SMS de RingCentral del candidato, del mas
// reciente al mas antiguo. Nunca devuelve `recording_path` ni `recording_uri`: solo `hasRecording`. La audiencia de las
// grabaciones la decide la ruta /recording (URL firmada). La consulta va con la sesion del admin, asi que RLS es la
// segunda puerta.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const auth = await requireAdminDeRc();
  if (!auth.ok) return auth.response;

  const candidato = new URL(req.url).searchParams.get("candidate") ?? "";
  if (!UUID.test(candidato)) return NextResponse.json({ error: "candidate required" }, { status: 400 });

  const { data, error } = await auth.supabase.schema("recruiting").from("rc_comms")
    .select("id, rc_id, kind, direction, at, duration_s, result, body, phone, recording_path, recording_pending")
    .eq("candidate_id", candidato)
    .order("at", { ascending: false })
    .limit(500);
  if (error) return errorAlCliente("recruiting-rc-comms", error, 503);

  const filas = (data ?? []).map(({ recording_path, ...resto }) => ({ ...resto, hasRecording: !!recording_path }));
  return NextResponse.json({ rows: filas });
}
