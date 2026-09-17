import { NextResponse } from "next/server";
import { DEFAULT_HELP_EMAIL } from "@/lib/constants";
import { resendFrom } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { CUBO_DE_ADJUNTOS, LIMITES_DE_ADJUNTOS, VALIDEZ_DEL_ENLACE, esMiRuta, lineasDeAdjuntos } from "@/lib/help-attachments";

import { requireUser } from "@/lib/api-auth";

// ============================================================
// In-app Help button (#help) — emails a support request to the address an
// admin configures in Settings (Settings.help_email, default DEFAULT_HELP_EMAIL).
//
// The client sends the user's message plus lightweight context (who they are,
// which page they were on, the app version). We compose a readable support
// email and deliver it through Resend — the same provider the customer-
// notification path uses. With RESEND_API_KEY / NOTIFY_FROM_EMAIL unset it
// runs in dry-run mode (ok:false, dryRun:true) so the button still "works"
// in local/demo without a mail account.
//
// replyTo is set to the requester's email so hitting reply reaches them.
// ============================================================

export const runtime = "nodejs";

interface HelpBody {
  message: string;
  to?: string;          // help recipient (Settings.help_email); server clamps to a default
  page?: string;        // where the user was when they tapped Help
  senderName?: string;
  senderEmail?: string;
  role?: string;
  appVersion?: string;
  lang?: string;
  /** Lo ya subido al cubo privado: la ruta dentro de `help-files` y con qué nombre se eligió. */
  archivos?: { path?: string; nombre?: string }[];
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  // Sin sesión no hay servicio (D-172): esta ruta estaba abierta a internet.
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  let body: HelpBody;
  try {
    body = (await req.json()) as HelpBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message || "").trim();
  if (!message) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  const to = EMAIL_RE.test((body.to || "").trim()) ? body.to!.trim() : DEFAULT_HELP_EMAIL;
  const senderEmail = (body.senderEmail || "").trim();
  const who = body.senderName?.trim() || senderEmail || "A user";
  const roleLabel = body.role ? ` (${body.role})` : "";

  // Los adjuntos (D-284). Se firma SOLO lo que está en la carpeta de quien manda la solicitud: la
  // ruta llega del cliente, y sin esta comprobación bastaría con escribir la carpeta de otra persona
  // para llevarse un enlace firmado a su fichero. El cubo ya lo impide al leer con la sesión, pero
  // aquí se firma con la llave de servicio, que se salta RLS.
  const pedidos = (body.archivos ?? []).slice(0, LIMITES_DE_ADJUNTOS.maxFicheros);
  const mios = pedidos.filter((a) => esMiRuta((a.path || "").trim(), auth.user.id));
  const adjuntos: { nombre: string; url: string | null }[] = [];
  if (mios.length) {
    const almacen = createAdminClient().storage.from(CUBO_DE_ADJUNTOS);
    for (const a of mios) {
      const ruta = (a.path || "").trim();
      const nombre = (a.nombre || "").trim() || ruta.split("/").pop() || "archivo";
      try {
        const { data } = await almacen.createSignedUrl(ruta, VALIDEZ_DEL_ENLACE);
        adjuntos.push({ nombre, url: data?.signedUrl ?? null });
      } catch {
        // Un enlace que no se pudo firmar no tumba la solicitud: el mensaje vale por sí solo, y el
        // correo dice qué adjunto se quedó sin enlace.
        adjuntos.push({ nombre, url: null });
      }
    }
  }

  // Se guarda antes de intentar el correo (D-NEXT). Si la llamada a Resend revienta o tarda, la
  // solicitud ya está en el historial que el admin ve en el hub; el resultado del envío se anota
  // justo después, sobre esta misma fila.
  const { data: fila, error: errorAlGuardar } = await auth.supabase
    .from("help_requests")
    .insert({
      user_id: auth.user.id,
      sender_name: body.senderName?.trim() || null,
      sender_email: senderEmail || null,
      role_label: body.role?.trim() || null,
      page: body.page?.trim() || null,
      app_version: body.appVersion?.trim() || null,
      lang: body.lang?.trim() || null,
      message,
      files: mios.map((a) => ({ path: (a.path || "").trim(), nombre: (a.nombre || "").trim() })),
      email_to: to,
    })
    .select("id")
    .maybeSingle();
  // Guardar es lo importante: si ni eso se pudo, se dice, en vez de mandar un correo que nadie podrá
  // volver a encontrar.
  if (errorAlGuardar) {
    return NextResponse.json({ error: "could not save the request", detail: errorAlGuardar.message }, { status: 500 });
  }

  /** El resultado del envío, sobre la fila recién creada. Con la llave de servicio: la política de la
   *  120 deja actualizar solo al admin, y quien escribe la solicitud casi nunca lo es. */
  const anotaElEnvio = async (ok: boolean, error?: string) => {
    if (!fila?.id) return;
    try {
      await createAdminClient().from("help_requests").update({ email_ok: ok, email_error: error ?? null }).eq("id", fila.id);
    } catch { /* el correo ya se intentó; no se pierde la solicitud por no poder anotarlo */ }
  };

  const subject = `Help request from ${who}${roleLabel}`;
  const text = [
    message,
    "",
    "———",
    `From: ${who}${senderEmail ? ` <${senderEmail}>` : ""}${roleLabel}`,
    body.page ? `Page: ${body.page}` : null,
    body.appVersion ? `App version: ${body.appVersion}` : null,
    body.lang ? `Language: ${body.lang}` : null,
    `Sent: ${new Date().toISOString()}`,
    ...lineasDeAdjuntos(adjuntos),
  ]
    .filter(Boolean)
    .join("\n");

  const key = process.env.RESEND_API_KEY;
  const from = resendFrom();
  if (!key || !from) {
    // No mail provider yet — don't fail the button; report dry-run so the UI
    // can tell the user their request was recorded but email isn't live. La solicitud SÍ queda
    // guardada, y el historial dice que no salió correo.
    await anotaElEnvio(false, "email provider not configured");
    return NextResponse.json({ ok: false, dryRun: true, reason: "email provider not configured", to });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject,
        text,
        ...(EMAIL_RE.test(senderEmail) ? { reply_to: senderEmail } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      await anotaElEnvio(false, `email send failed (${res.status}) ${detail}`.trim());
      return NextResponse.json({ error: `email send failed (${res.status})`, detail }, { status: 502 });
    }
    await anotaElEnvio(true);
    return NextResponse.json({ ok: true, to });
  } catch (e) {
    await anotaElEnvio(false, (e as Error).message);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
