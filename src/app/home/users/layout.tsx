import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { ConfirmProvider } from "@/lib/confirm";
import { landingRoute } from "@/lib/constants";
import type { Profile } from "@/lib/types";

// Users' own gate (D-056) — a Server Component redirect, not the Client
// Component "Admins only" message the page used to show after already
// mounting the data provider and fetching everyone's profile. A non-admin
// never gets that far now: same authority as before (only a deliveries
// admin can be here), just enforced one layer earlier. Moving the SCREEN
// doesn't move the real boundary either way — guard_recruiting_access_change
// on the database still requires a deliveries admin for any write to
// recruiting_role/module_access, from any URL (D-050).
//
// The DataProvider lives HERE, not in the parent home/layout.tsx: the
// selector at /home doesn't touch deliveries data at all, so mounting its
// realtime channels there would be paying for something nobody on that page
// uses — same locality principle D-052 already applied to recruiting.
export default async function HomeUsersLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/users");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  // Degraded session, not a new user — see the identical guard in
  // (app)/layout.tsx.
  if (!profile) redirect("/login?next=/home/users");
  const me: Profile = profile;

  // Reaching this layout is not, by itself, proof of anything — same pattern
  // as recruiting's own guard (D-052). A non-admin who types the URL lands
  // wherever they actually belong, not on a wall of "Admins only."
  if (me.role !== "admin") redirect(landingRoute(me));

  return (
    <ConfirmProvider>
      <DataProvider me={me}>
        <div className="wrap">{children}</div>
      </DataProvider>
    </ConfirmProvider>
  );
}
