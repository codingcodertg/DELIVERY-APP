import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { ringcentralAddContact, ringcentralConfigured, ringcentralContacts } from "@/lib/ringcentral";
import { cuerpoDelContacto, nombreParaRingCentral, yaEstaEnLaAgenda } from "@/lib/recruiting/contacto-ringcentral";

// ============================================================
// POST /api/recruiting/rc-contact · { candidateId } (D-NEXT). Guarda al candidato como contacto en la agenda de la
// extensión de RingCentral del servidor (la línea «Careers», desde la que RR. HH. llama y textea), con el nombre
// «Andres Ugarte WA BRO». Idempotente: si la agenda ya tiene ese teléfono, no crea otro.
//
// La puerta es la sesión (`requireUser`) y la RLS de `recruiting.candidates`: si el usuario no puede leer al candidato
// (no tiene el módulo de RR. HH.), la lectura vuelve vacía y se contesta 404. No gasta nada fuera si RingCentral no
// está configurado (`dryRun`), igual que `/api/call`.
// ============================================================

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

  try {
    const agenda = await ringcentralContacts();
    if (yaEstaEnLaAgenda(agenda, c.phone)) return NextResponse.json({ ok: true, created: false, display });
    await ringcentralAddContact(cuerpo);
    return NextResponse.json({ ok: true, created: true, display });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
