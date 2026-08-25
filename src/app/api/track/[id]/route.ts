import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================
// Public delivery-tracking endpoint. A customer opens /track/<id> (no login)
// and the page reads its status here. We use the service-role client (server
// only) but return ONLY the non-sensitive, customer-facing status fields —
// never fees, phone, internal notes, or anything else on the row.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // always fresh — status changes live

// The only columns exposed to the public tracking page.
const PUBLIC_FIELDS = "order_no, order_code, stage, account, delivery_date, delivery_windows, delivery_address, assigned_driver, pod_received_by";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Tracking is not configured." }, { status: 500 });
  }

  const { data, error } = await admin
    .from("deliveries")
    .select(PUBLIC_FIELDS)
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Lookup failed" }, { status: 502 });
  if (!data) return NextResponse.json({ order: null }, { status: 404 });

  return NextResponse.json(
    { order: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
