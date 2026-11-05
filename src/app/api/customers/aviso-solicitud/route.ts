import { NextResponse } from "next/server";
import { resendFrom } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient as createErpClient } from "@/lib/erp/supabase/server";
import { destinoDeAyuda } from "@/lib/ayuda-flotante";
import { origenPublico } from "@/lib/avisos-cliente-envio";
import { requireUser } from "@/lib/api-auth";
import { asuntoDelCorreoDeSolicitud, enlaceDelAviso, AVISO_CLIENTE_NUEVA } from "@/lib/customers/avisos-de-solicitud";
import { mensajeDeAltaPendiente, resumenDeSolicitud, solicitudDeLaBase } from "@/lib/customers/solicitud-de-cliente";
import { mensajeDeEdicionPendiente } from "@/lib/customers/edicion-como-solicitud";

// ============================================================
// El correo al admin de una solicitud de cliente (alta o edición).
//
// Antes se mandaba por `/api/help`: llegaba como «Help request», se guardaba en `help_requests` y salía en
// «Solicitudes de ayuda» del hub. Ahora es su propio correo, titulado «New customer request», con el enlace que abre
// la solicitud en el panel de Solicitudes de Clientes. No escribe en `help_requests`.
//
// El navegador manda solo el id; la solicitud se lee con la sesión de quien llama (RLS: solo ve las suyas, o todas si
// es admin), y solo se avisa de una que pidió quien llama. Va a la misma dirección que la ayuda (`settings.help_email`).
// ============================================================

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let id = 0;
  try { id = Number(((await req.json()) as { id?: unknown }).id); } catch { /* abajo */ }
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id required" }, { status: 400 });

  const erp = await createErpClient();
  const { data: fila } = await erp.from("customer_requests").select("id, requested_by, stores, payload, status, created_at, decided_at, decision_note, created_ids, kind, customer_id, before, note").eq("id", id).maybeSingle();
  if (!fila) return NextResponse.json({ error: "not found" }, { status: 404 });
  const s = solicitudDeLaBase(fila as unknown as Record<string, unknown>);
  if (s.requested_by !== auth.user.id) return NextResponse.json({ error: "not yours" }, { status: 403 });
  // Solo altas y ediciones: las asociaciones tienen su propio flujo.
  if (s.kind !== "alta" && s.kind !== "edicion") return NextResponse.json({ error: "unsupported kind" }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: ajustes }, { data: perfil }] = await Promise.all([
    admin.from("settings").select("help_email").eq("id", 1).maybeSingle(),
    auth.supabase.from("profiles").select("full_name, role, email").eq("id", auth.user.id).maybeSingle(),
  ]);
  const to = destinoDeAyuda((ajustes as { help_email?: string | null } | null)?.help_email);
  const quien = (perfil?.full_name as string | null | undefined)?.trim() || auth.user.email || "?";
  const rol = (perfil?.role as string | null | undefined) ?? null;
  const cuenta = s.kind === "edicion" ? String((s.before as Record<string, unknown> | null)?.account ?? s.payload.account ?? "?") : resumenDeSolicitud(s).cuenta;

  const subject = asuntoDelCorreoDeSolicitud(s.kind, { cuenta, quien, rol });
  const enlace = `${origenPublico(req.url)}${enlaceDelAviso(AVISO_CLIENTE_NUEVA, s)}`;
  const cuerpo = s.kind === "edicion" ? mensajeDeEdicionPendiente(s, "en") : mensajeDeAltaPendiente(s, "en");
  const text = [cuerpo, "", `Open: ${enlace}`, "———", `From: ${quien}${rol ? ` (${rol})` : ""}`, `Sent: ${new Date().toISOString()}`].join("\n");

  const key = process.env.RESEND_API_KEY;
  const from = resendFrom();
  if (!key || !from) return NextResponse.json({ ok: false, dryRun: true, reason: "email provider not configured", to });
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, ...(auth.user.email ? { reply_to: auth.user.email } : {}) }),
    });
    if (!res.ok) return NextResponse.json({ error: `email send failed (${res.status})` }, { status: 502 });
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
