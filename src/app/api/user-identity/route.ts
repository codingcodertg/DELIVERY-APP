import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurity } from "@/lib/security-log-server";
import { change } from "@/lib/security-log";
import { emailForUsername, isSyntheticEmail, isValidUsername, normalizeUsername } from "@/lib/username";

// ============================================================
// Change how a person signs in: their username, their email, or both.
//
// The two are not independent. A user with no email signs in at an address
// DERIVED from their username, so renaming them without moving that address
// would lock them out of an account that still looks fine in the list. Both
// moves happen here, together, or neither does.
//
// Admins only, and never touches passwords — this changes who someone is, not
// how they prove it.
// ============================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read how someone signs in today.
 *
 * The email lives in auth, not in `profiles`, so the office had no way to see
 * what address an account actually uses — only to overwrite it blind.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Missing user." }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(id);
  if (!data?.user) return NextResponse.json({ error: "No such user." }, { status: 404 });

  const email = data.user.email ?? "";
  const synthetic = isSyntheticEmail(email);
  return NextResponse.json({
    // A derived address is machinery, not a contact. Reporting it as this
    // person's email would put it on a customer form one day.
    email: synthetic ? "" : email,
    synthetic,
    can_reset_own_password: !synthetic,
    last_sign_in_at: data.user.last_sign_in_at ?? null,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can change sign-in details." }, { status: 403 });
  }

  let body: { id?: string; username?: string | null; email?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid body." }, { status: 400 }); }

  const id = (body.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing user." }, { status: 400 });

  const admin = createAdminClient();
  const { data: target, error: findErr } = await admin.auth.admin.getUserById(id);
  if (findErr || !target?.user) return NextResponse.json({ error: "No such user." }, { status: 404 });
  const currentEmail = target.user.email ?? "";

  // ---- Username -----------------------------------------------------------
  const wantsUsername = body.username !== undefined;
  const username = body.username === null ? null : normalizeUsername(body.username);
  if (wantsUsername && username !== null && !isValidUsername(username)) {
    return NextResponse.json({
      error: "Username must be 3–30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.",
    }, { status: 400 });
  }

  // ---- Email --------------------------------------------------------------
  // Three different intents, and the difference matters:
  //   absent  - don't touch it
  //   a value - set it
  //   null/"" - REMOVE it: this person signs in with their username from now on
  const emailGiven = body.email !== undefined;
  const emailRaw = (body.email ?? "").trim();
  const clearingEmail = emailGiven && emailRaw === "";
  const wantsEmail = emailGiven && emailRaw !== "";
  const email = wantsEmail ? emailRaw.toLowerCase() : "";
  if (wantsEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // Whose username applies after this call - the one being set, or the one
  // already on file.
  const { data: profile } = await admin.from("profiles").select("username").eq("id", id).maybeSingle();
  const effectiveUsername = wantsUsername ? username : ((profile?.username as string | null) ?? null);

  // Removing the email is the ONLY way to turn an email account into a
  // username account, and it has to be explicit. A username edit alone never
  // rewrites a real address - doing that as a side effect of renaming would be
  // silent account theft - but clearing the email field is someone saying
  // exactly what they mean.
  //
  // Refused without a username, because the alternative is an account with no
  // way at all to sign in.
  if (clearingEmail && !effectiveUsername) {
    return NextResponse.json({
      error: "Give this person a username first - removing their email would leave no way to sign in.",
    }, { status: 400 });
  }

  // A real email otherwise wins: giving someone a proper address is also
  // giving them the ability to reset their own password, which a derived one
  // can never do.
  let nextEmail: string | null = null;
  if (wantsEmail) nextEmail = email;
  else if (clearingEmail) nextEmail = emailForUsername(effectiveUsername!);
  else if (wantsUsername && username && isSyntheticEmail(currentEmail)) nextEmail = emailForUsername(username);

  if (nextEmail && nextEmail !== currentEmail.toLowerCase()) {
    const { error } = await admin.auth.admin.updateUserById(id, { email: nextEmail, email_confirm: true });
    if (error) {
      const taken = /already|registered|exists/i.test(error.message);
      return NextResponse.json(
        { error: taken ? "That email or username is already taken." : error.message },
        { status: taken ? 409 : 500 },
      );
    }
  }

  if (wantsUsername) {
    const { error } = await admin.from("profiles").update({ username }).eq("id", id);
    if (error) {
      const taken = /duplicate|unique/i.test(error.message);
      return NextResponse.json(
        { error: taken ? "That username is already taken." : error.message },
        { status: taken ? 409 : 500 },
      );
    }
  }

  const { data: prof } = await admin.from("profiles").select("full_name").eq("id", id).maybeSingle();
  const targetName = prof?.full_name ?? null;
  if (nextEmail && nextEmail !== currentEmail.toLowerCase()) {
    await logSecurity({ actorId: user.id, targetId: id, targetName, kind: "email_changed", detail: change(currentEmail, nextEmail) });
  }
  if (wantsUsername) {
    await logSecurity({ actorId: user.id, targetId: id, targetName, kind: "username_changed", detail: change(profile?.username ?? null, username) });
  }

  return NextResponse.json({
    ok: true,
    email: nextEmail ?? currentEmail,
    username: wantsUsername ? username : undefined,
    // The office needs to know when a person has no way back in on their own.
    can_reset_own_password: !isSyntheticEmail(nextEmail ?? currentEmail),
  });
}
