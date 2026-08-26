import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";

// The hub's own auth boundary — the one thing every page under /home
// genuinely shares. Profile fetching is NOT centralized here: Next can't
// inject props from a layout into `children`, so each page/nested-layout
// that needs `me` fetches its own copy, same as (app)/layout.tsx and
// recruiting/(recruiting)/layout.tsx already do independently of each other
// (D-052) — this is the third instance of that pattern, not a new one.
//
// AppUpdateBanner is mounted here too (D-063): it was living inside
// deliveries' own TopBar, so nobody outside (app) — the hub, recruiting —
// ever heard that a new deploy was ready. It has no dependency on
// deliveries' DataProvider.
//
// app="deliveries" (D-087, judgment call): /home isn't recruiting's or
// timetracker's own route tree — it's genuinely shared, cross-app
// infrastructure (the module picker) that happens to live physically
// outside all three app folders, same as /login. It's owned by and styled
// like deliveries, and everyone reaching it already has deliveries access
// (it's the one app nobody needs a grant for), so deliveries' version is
// the least-wrong single answer for a page that isn't really "an app" of
// its own to begin with.
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home");

  return (
    <>
      <AppUpdateBanner app="deliveries" />
      {children}
    </>
  );
}
