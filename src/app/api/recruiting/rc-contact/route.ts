import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { ringcentralAddContact, ringcentralConfigured, ringcentralContacts } from "@/lib/ringcentral";
import { cuerpoDelContacto, nombreParaRingCentral, yaEstaEnLaAgenda } from "@/lib/recruiting/contacto-ringcentral";
import { AGENDA_DEL_SERVIDOR, agendasExtraDesde, type CredencialesRingCentral } from "@/lib/recruiting/agendas-ringcentral";

// ============================================================
// POST /api/recruiting/rc-contact · { candidateId } (D-591). Guarda al candidato como contacto en la agenda de la
// extensión de RingCentral del servidor (la línea «Careers», desde la que RR. HH. llama y textea), con el nombre
// «Andres Ugarte WA BRO». Idempotente: si la agenda ya tiene ese teléfono, no crea otro.
//
// La puerta es la sesión (`requireUser`) y la RLS de `recruiting.candidates`: si el usuario no puede leer al candidato
// (no tiene el módulo de RR. HH.), la lectura vuelve vacía y se contesta 404. No gasta nada fuera si RingCentral no
// está configurado (`dryRun`), igual que `/api/call`.
//
// D-NEXT: además de la agenda del servidor («Careers»), en cada agenda extra de `RINGCENTRAL_AGENDAS_EXTRA` (la del dueño:
// otra cuenta de RingCentral, con su propia app y su JWT). Cada agenda se mira y se escribe por separado; si una falla,
// las demás siguen, y la respuesta dice en cuáles quedó (`agendas`) y en cuáles falló (`fallos`).
// ============================================================

async function guardarEn(nombre: string, cuerpo: Record<string, string>, phone: string, creds?: CredencialesRingCentral): Promise<{ nombre: string; created: boolean }> {
  const agenda = await ringcentralContacts(creds);
  if (yaEstaEnLaAgenda(agenda, phone)) return { nombre, created: false };
  await ringcentralAddContact(cuerpo, creds);
  return { nombre, created: true };
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.candidateId === "string" ? body.candidateId : "";
  if (!id) return NextResponse.json({ error: "candidateId required" }, { status: 400 });

  const { data: c, error } = await auth.supabase.schema("recruiting").from("candidates")
    .select("id, name, phone, role, location").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const cuerpo = cuerpoDelContacto(c);
  if (!cuerpo) return NextResponse.json({ ok: false, reason: "no-phone" }, { status: 200 });
  const { display } = nombreParaRingCentral(c);
  if (!ringcentralConfigured()) return NextResponse.json({ ok: false, dryRun: true, display });

  const extras = agendasExtraDesde(process.env.RINGCENTRAL_AGENDAS_EXTRA);
  const resultados = await Promise.allSettled([
    guardarEn(AGENDA_DEL_SERVIDOR, cuerpo, c.phone),
    ...extras.map((a) => guardarEn(a.nombre, cuerpo, c.phone, a)),
  ]);
  const agendas: string[] = [];
  const fallos: string[] = [];
  let created = false;
  resultados.forEach((r, i) => {
    const nombre = i === 0 ? AGENDA_DEL_SERVIDOR : extras[i - 1].nombre;
    if (r.status === "fulfilled") { agendas.push(r.value.nombre); created = created || r.value.created; }
    else fallos.push(`${nombre}: ${(r.reason as Error)?.message ?? "error"}`);
  });
  if (agendas.length === 0) return NextResponse.json({ error: fallos.join(" · ") }, { status: 502 });
  return NextResponse.json({ ok: true, created, display, agendas, fallos });
}
