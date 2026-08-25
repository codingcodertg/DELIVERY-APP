import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSecurity } from "@/lib/security-log-server";
import { emailForUsername, isValidUsername, normalizeUsername } from "@/lib/username";

const ROLES = ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"] as const;
type Role = (typeof ROLES)[number];

/** A readable temporary password like "Swift-Puma-4821". */
function generatePassword(): string {
  const adj = ["Swift", "Bright", "Bold", "Calm", "Sharp", "Quick", "Solid", "Prime"];
  const noun = ["Puma", "Falcon", "Cedar", "River", "Delta", "Comet", "Harbor", "Summit"];
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(adj)}-${pick(noun)}-${1000 + Math.floor(Math.random() * 9000)}`;
}

export async function POST(req: Request) {
  // 1) Who is calling? Must be a signed-in admin.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can add users." }, { status: 403 });
  }

  // 2) Validate input.
  let body: { email?: string; username?: string; full_name?: string; role?: string; password?: string; store?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const full_name = (body.full_name || "").trim();
  const role: Role = ROLES.includes(body.role as Role) ? (body.role as Role) : "sales";
  const store = (body.store || "").trim() || null;

  // A person with no email signs in with a username, at an address derived
  // from it. Warehouse and drivers rarely have a company address; making one
  // up for them was the alternative, and then nobody remembers it.
  const username = body.username ? normalizeUsername(body.username) : "";
  const typedEmail = (body.email || "").trim().toLowerCase();
  if (!username && !typedEmail) {
    return NextResponse.json({ error: "Enter an email address or a username." }, { status: 400 });
  }
  if (username && !isValidUsername(username)) {
    return NextResponse.json({
      error: "Username must be 3–30 characters: letters, numbers, dot, dash or underscore, starting with a letter or number.",
    }, { status: 400 });
  }
  if (typedEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(typedEmail)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  // A real address wins when both are given: only a real one can carry a
  // password-reset link.
  const email = typedEmail || emailForUsername(username);
  const wanted = (body.password || "").trim();
  if (wanted && wanted.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }
  const password = wanted || generatePassword();

  // 3) Create the account directly, pre-confirmed. No email is sent, so the
  //    user can sign in immediately with the email + password below. full_name
  //    + role travel in metadata and are applied by the handle_new_user trigger.
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel and redeploy." },
      { status: 500 },
    );
  }

  let newUserId: string | null = null;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // bypass email verification — account is active at once
      user_metadata: { full_name: full_name || email.split("@")[0], role },
    });
    if (error) {
      const msg = /already been registered|already exists|duplicate/i.test(error.message)
        ? "That email already has an account."
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    newUserId = data.user?.id ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: "Create failed: " + msg }, { status: 500 });
  }

  // The handle_new_user trigger seeds the profile from metadata (full_name +
  // role). Store isn't in metadata, so stamp it (and re-assert name/role) on the
  // fresh profile row here. Best-effort — a failure here doesn't undo the login.
  if (newUserId) {
    await admin.from("profiles")
      .update({ store, full_name: full_name || username || email.split("@")[0], role, username: username || null })
      .eq("id", newUserId);
  }

  await logSecurity({
    actorId: user.id,
    targetId: newUserId,
    targetName: full_name || username || email,
    kind: "user_created",
    detail: `${role}${username ? ` · @${username}` : ` · ${email}`}${store ? ` · ${store}` : ""}`,
  });

  // Return the password so the admin can hand it to the user. `signInWith` is
  // what they should actually be told to type — for a username account the
  // derived address is an implementation detail nobody should have to know.
  return NextResponse.json({
    ok: true,
    email,
    username: username || null,
    signInWith: username || email,
    password,
    id: newUserId,
    // Said plainly so it isn't discovered the day someone forgets a password.
    can_reset_own_password: !!typedEmail,
  });
}
