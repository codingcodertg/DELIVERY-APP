import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { secretoDelCv, tokenDelCv, urlDelCv } from "@/lib/recruiting/enlace-corto-del-cv";

// ============================================================
// POST /api/recruiting/cv-link · { candidateId } (D-593): el enlace corto del CV para «Copiar para el gerente».
// Sesión (`requireUser`) + RLS de `recruiting.candidates` como puerta del módulo (si no puede leer al candidato, 404).
// Devuelve `{ url }` —`https://<esta app>/api/cv/<token>`, unos 60 caracteres— o `{ url: null }` si no hay CV.
// ============================================================

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const id = typeof body?.candidateId === "string" ? body.candidateId : "";
  if (!id) return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  const { data: c, error } = await auth.supabase.schema("recruiting").from("candidates").select("id, resume_path").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  if (!c) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  if (!c.resume_path) return NextResponse.json({ url: null });
  const token = tokenDelCv(c.id, secretoDelCv());
  if (!token) return NextResponse.json({ error: "Bad candidate id" }, { status: 400 });
  return NextResponse.json({ url: urlDelCv(new URL(req.url).origin, token) });
}
