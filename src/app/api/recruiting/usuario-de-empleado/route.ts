import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { expedienteQueSobra } from "@/lib/recruiting/usuarios-rrhh";

// ============================================================
// /api/recruiting/usuario-de-empleado (D-702): lo que «Crear usuario» de Empleados necesita en /home/users.
// GET  → `{ files }`: los expedientes que la RLS deja leer, solo las columnas de la precarga y `profile_id`.
// POST · { fileId, profileId } → enlaza el expediente con la cuenta recién creada.
// Es una ruta y no una acción de servidor a propósito: D-695 importaba `actions/hr` en la página de cliente y el build
// de Vercel moría por memoria (SIGKILL). Aquí no entra nada de RR. HH. salvo `usuarios-rrhh.ts`, que es puro.
// ============================================================

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  // `*` y no una lista: `personal_email` llegó con la 159 y pedirla por nombre rompería sin ella.
  const { data, error } = await auth.supabase.schema("recruiting").from("employee_files").select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  const files = (data ?? []).map((f: Record<string, unknown>) => ({
    id: f.id as string,
    profile_id: (f.profile_id as string) ?? null,
    full_name: (f.full_name as string) ?? null,
    email: (f.email as string) ?? null,
    personal_email: (f.personal_email as string) ?? null,
    store: (f.store as string) ?? null,
  }));
  return NextResponse.json({ files });
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const fileId = typeof body?.fileId === "string" ? body.fileId : "";
  const profileId = typeof body?.profileId === "string" ? body.profileId : "";
  if (!fileId || !profileId) return NextResponse.json({ error: "fileId and profileId required" }, { status: 400 });
  const supabase = auth.supabase;
  const { data: yo, error: errYo } = await supabase.from("profiles").select("recruiting_role").eq("id", auth.user.id).maybeSingle();
  if (errYo) return NextResponse.json({ error: errYo.message }, { status: 503 });
  // Solo el admin de RR. HH.: lo mismo exige el trigger de la 106.
  if (yo?.recruiting_role !== "admin") return NextResponse.json({ error: "Only an HR admin can link an employee file to an account." }, { status: 403 });

  const rec = supabase.schema("recruiting");
  const { data: file, error: errFile } = await rec.from("employee_files").select("id, profile_id").eq("id", fileId).maybeSingle();
  if (errFile) return NextResponse.json({ error: errFile.message }, { status: 503 });
  if (!file) return NextResponse.json({ error: "Employee file not found." }, { status: 404 });
  if (file.profile_id === profileId) return NextResponse.json({ ok: true });
  if (file.profile_id) return NextResponse.json({ error: "This employee already has an account." }, { status: 409 });

  // Al nacer la cuenta, el trigger de la 106 le hace un expediente vacío propio: se borra si no tiene papeles.
  const { data: delPerfil, error: errDel } = await rec.from("employee_files").select("id").eq("profile_id", profileId);
  if (errDel) return NextResponse.json({ error: errDel.message }, { status: 503 });
  const conDocs: { id: string; docs: number }[] = [];
  for (const f of delPerfil ?? []) {
    const { count, error } = await rec.from("employee_docs").select("id", { count: "exact", head: true }).eq("employee_id", f.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    conDocs.push({ id: f.id as string, docs: count ?? 0 });
  }
  const d = expedienteQueSobra(fileId, profileId, conDocs);
  if (!d.ok) return NextResponse.json({ error: d.message }, { status: 409 });
  if (d.borrar) {
    // Con .select("id"): un DELETE que la RLS deja en cero filas vuelve sin error.
    const { data: borrados, error } = await rec.from("employee_files").delete().eq("id", d.borrar).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 503 });
    if (!borrados?.length) return NextResponse.json({ error: "Could not remove the empty file created with the account." }, { status: 409 });
  }
  const { data: hechos, error: errUp } = await rec.from("employee_files").update({ profile_id: profileId }).eq("id", fileId).select("id");
  if (errUp) return NextResponse.json({ error: errUp.message }, { status: 503 });
  if (!hechos?.length) return NextResponse.json({ error: "The employee file was not updated." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
