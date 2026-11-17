import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDailySummary, COLUMNAS_DEL_RESUMEN, filtroDelResumen, summaryLines } from "@/lib/daily-summary";
import { createNotionPage, notionConfigured } from "@/lib/notion";
import { orderLabel, todayISO } from "@/lib/utils";
import { igualesEnTiempoConstante } from "@/lib/comparar-secreto";
import type { Delivery, DriverShift } from "@/lib/types";

// ============================================================
// Posts the day's summary to Notion.
//
// Two ways in, and they need different proof:
//   • Vercel Cron  — sends Authorization: Bearer $CRON_SECRET (GET)
//   • A person     — must be a signed-in admin, and must use POST from this origin
//
// Anything else is refused. Without that, a public URL that writes to the
// company's Notion could be hit all day by anyone who guessed it.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Quién llama. El cron (Bearer con CRON_SECRET, comparado en tiempo constante) puede llegar por GET, que es lo que
 * manda Vercel Cron. Un admin con sesión solo por POST y desde el mismo origen: un GET de otra página con la sesión
 * del admin publicaría el resumen en Notion (CSRF).
 */
async function quienLlama(req: Request): Promise<"cron" | "admin" | "no" | "metodo" | "origen"> {
  const secret = process.env.CRON_SECRET;
  if (secret && igualesEnTiempoConstante(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return "cron";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "no";
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return "no";
  if (req.method !== "POST") return "metodo";
  const origen = req.headers.get("origin");
  if (origen && origen !== new URL(req.url).origin) return "origen";
  return "admin";
}

async function post(req: Request): Promise<NextResponse> {
  const quien = await quienLlama(req);
  if (quien === "no") return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  if (quien === "metodo") return NextResponse.json({ error: "Use POST." }, { status: 405 });
  if (quien === "origen") return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (!notionConfigured()) {
    // Name the missing variable rather than saying "not configured". The vague
    // version sent someone hunting through three possible causes; this points
    // straight at one. Only NAMES are reported, never values, and the route
    // already requires an admin session or the cron secret to get this far.
    const missing = (["NOTION_TOKEN", "NOTION_DATABASE_ID"] as const).filter((k) => !process.env[k]);
    return NextResponse.json({
      skipped: "Notion not configured",
      missing,
      hint: "Add them in Vercel → Settings → Environment Variables (tick Production), then redeploy — new variables only reach a NEW deployment.",
      deployment: process.env.VERCEL_ENV ?? "local",
      cron_secret_set: !!process.env.CRON_SECRET,
    });
  }

  // The date to report on: today in business time, or ?date=YYYY-MM-DD to
  // re-run a day by hand.
  const asked = new URL(req.url).searchParams.get("date");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asked ?? "") ? asked! : todayISO();

  // Service role: a cron run has no user session to read the board with.
  // Solo las órdenes que el resumen puede contar (`filtroDelResumen`) y solo sus columnas (`COLUMNAS_DEL_RESUMEN`).
  // Los turnos ya no se leen: `buildDailySummary` no los usa (la firma los recibe, pero no los mira).
  const admin = createAdminClient();
  const { data: deliveries } = await admin
    .from("deliveries")
    .select(COLUMNAS_DEL_RESUMEN)
    .or(filtroDelResumen(date));

  const summary = buildDailySummary(
    (deliveries ?? []) as unknown as Delivery[],
    [] as DriverShift[],
    date,
    (d) => orderLabel(d),
  );

  const res = await createNotionPage(`Resumen ${date}`, summaryLines(summary, "es"));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 502 });
  return NextResponse.json({ ok: true, date, url: res.url, delivered: summary.delivered, missed: summary.missed });
}

// Vercel Cron issues a GET; a person testing it will reach for POST.
export const GET = post;
export const POST = post;
