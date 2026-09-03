import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { DataProvider } from "@/lib/recruiting-data-provider";
import { UIProvider } from "@/components/recruiting/ModalHost";
import { TopBar } from "@/components/recruiting/TopBar";
import { VersionFooter } from "@/components/recruiting/VersionFooter";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import type { Profile as RecruitingProfile } from "@/lib/recruiting/types";
import "../recruiting.css";

// The root layout (app/layout.tsx) sets the browser tab title to "RDZ
// Deliveries | Order & Dispatch" — correct for (app), never overridden for
// recruiting, so every /recruiting/* tab said "RDZ Deliveries" too. Next
// only inherits a parent's metadata when a layout doesn't set its own; this
// is that override.
//
// Deliberately NOT settings.app_name (today "RTG RECRUITER" in the DB,
// shown in the in-page <h1> via TopBar.tsx) — the browser tab title and the
// on-page brand name are two different things here, on purpose. Reading
// settings.app_name for the tab too would need an async generateMetadata()
// querying the DB on every request; not worth it for a static string.
export const metadata: Metadata = {
  // "HR Management" desde D-145; la pestaña del navegador se quedó con el nombre viejo (B-8).
  title: "RDZ HR Management",
};

// The recruiting module's own shell — a sibling of (app), not nested under
// it. Nothing from deliveries' layout is inherited here on purpose: no
// deliveries DataProvider (its realtime channels have nothing to do with
// recruiting data), no DriverGate/LocationTracker (GPS tracking is a
// deliveries-driver concept only). Auth + profile fetch are duplicated
// instead of shared, matching the pattern deliveries' own (app)/layout.tsx
// already uses — this is the second, independent copy of that pattern, not a
// new one. See D-050/D-052.
export default async function RecruitingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient(); // deliveries' client — public schema, shared identity
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/recruiting");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_url, recruiting_role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  // No recruiting access at all — bounce to wherever this person actually
  // belongs. Covers direct-URL access exactly like the /home guard does for
  // the module selector (D-051): reaching this layout is not, by itself,
  // proof of anything.
  if (!profile?.recruiting_role) {
    redirect(landingRoute({ role: profile?.role ?? "sales", module_access: profile?.module_access }));
  }

  const me: RecruitingProfile = {
    id: profile.id,
    full_name: profile.full_name ?? user.email ?? "Me",
    role: profile.recruiting_role as RecruitingProfile["role"],
    avatar_url: profile.avatar_url,
  };

  return (
    <div className="recruiting-module">
      {/* Deliberately outside DataProvider — the same reason deliveries' own
          TopBar.tsx mounts it unconditionally: a stale-JS check has nothing
          to do with recruiting's data at all (D-063). */}
      <AppUpdateBanner app="recruiting" />
      <DataProvider me={me}>
        <UIProvider>
          <TopBar me={me} deliveriesRole={profile.role} moduleAccess={profile.module_access} />
          <div className="wrap">{children}</div>
          <VersionFooter />
        </UIProvider>
      </DataProvider>
    </div>
  );
}
