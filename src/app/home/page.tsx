import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accessibleModules, canReachHub, HUB_TOOLS, landingRoute } from "@/lib/constants";
import { HomeSelector } from "@/components/HomeSelector";
import type { Profile } from "@/lib/types";

// The hub. Landing here automatically vs. being ALLOWED to visit are two
// different questions now (D-056) — they used to be the same one.
//
// landingRoute() still answers "where do you land after login", unchanged:
// an admin with only deliveries still lands on `/` directly, exactly as
// before. `hasReasonToBeHere` below is the new, separate question — "is
// there anything on this page for you if you navigate here on purpose" —
// which an admin with 1 module now answers yes to (Users, in HUB_TOOLS)
// even though their landing route is still their module, not here. Keeping
// these as two distinct expressions (not folding one into the other) is
// deliberate: mixing "where you land" and "what you're allowed to visit"
// into one function is exactly the kind of blur that produced D-052's bugs.
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // A deep-link (e.g. a notification's ?order=<id>) always wins — never trap
  // it behind the selector. Forward it into deliveries, params intact.
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v == null ? [] : (Array.isArray(v) ? v : [v]).map((val) => [k, val] as [string, string]),
    ),
  ).toString();
  if (qs) redirect(`/?${qs}`);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  // Degraded session, not a new user — see the identical guard in
  // (app)/layout.tsx. Fabricating role:"sales" here used to route people
  // into the wrong module picker for their real role.
  if (!profile) redirect("/login");
  const me: Profile = profile;

  // La regla vive en canReachHub() con el candado del chofer (D-173): D-056 la escribió
  // aquí en línea y sin él, y `ModuleSwitcher` tenía la suya. Una sola, con prueba.
  if (!canReachHub(me)) redirect(landingRoute(me));

  return <HomeSelector me={me} />;
}
