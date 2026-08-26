import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurity } from "@/lib/security-log-server";

// ============================================================
// An admin sets a new password for someone who can't reset their own.
//
// This exists because of a deliberate tradeoff: a user with no email signs in
// with a username and no reset link can ever reach them (see lib/username).
// The agreed answer was "they call me" — so the office needs a way to answer
// that call in one click instead of rebuilding the account.
//
// The password is GENERATED here, never accepted from the caller. Letting an
// admin type one invites the same three words being handed to every driver in
// the yard, and the office would never know.
//
// Shown exactly once, in the response. It is never stored anywhere readable.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A password someone can read down a phone line without spelling it out. */
function generatePassword(): string {
  const adj = ["Swift", "Bright", "Bold", "Calm", "Sharp", "Quick", "Solid", "Prime"];
  const noun = ["Puma", "Falcon", "Cedar", "River", "Delta", "Comet", "Harbor", "Summit"];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(adj)}-${pick(noun)}-${1000 + Math.floor(Math.random() * 9000)}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can reset passwords." }, { status: 403 });
  }

  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }
  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing user." }, { status: 400 });

  const admin = createAdminClient();
  const { data: target } = await admin.auth.admin.getUserById(id);
  if (!target?.user) return NextResponse.json({ error: "No such user." }, { status: 404 });

  const password = generatePassword();
  const { error } = await admin.auth.admin.updateUserById(id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The record is that a reset HAPPENED, never what it produced.
  const { data: prof } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
  await logSecurity({ actorId: user.id, targetId: id, targetName: prof?.full_name ?? null, kind: "password_reset" });

  // Deliberately NOT signing their other sessions out. A driver mid-route with
  // the app open is not who this is for — they're locked out at the login
  // screen, not inside. Kicking the phone that's currently reporting position
  // would turn a forgotten password into a truck off the map.
  return NextResponse.json({
    ok: true,
    password,
    name: target.user.email ?? "",
  });
}
