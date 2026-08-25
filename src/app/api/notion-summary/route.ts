import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDailySummary, summaryLines } from "@/lib/daily-summary";
import { createNotionPage, notionConfigured } from "@/lib/notion";
import { orderLabel, todayISO } from "@/lib/utils";
import type { Delivery, DriverShift } from "@/lib/types";

// ============================================================
// Posts the day's summary to Notion.
//
// Two ways in, and they need different proof:
//   • Vercel Cron  — sends Authorization: Bearer $CRON_SECRET
//   • A person     — must be a signed-in admin
//
// Anything else is refused. Without that, a public URL that writes to the
// company's Notion could be hit all day by anyone who guessed it.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) return true;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return me?.role === "admin";
}

async function post(req: Request): Promise<NextResponse> {
  if (!(await authorized(req))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
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
  const admin = createAdminClient();
  const [{ data: deliveries }, { data: shifts }] = await Promise.all([
    admin.from("deliveries").select("*"),
    admin.from("driver_shifts").select("*"),
  ]);

  const summary = buildDailySummary(
    (deliveries ?? []) as Delivery[],
    (shifts ?? []) as DriverShift[],
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
