import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { DataProvider } from "@/lib/timetracker-data-provider";
import { TopBar } from "@/components/timetracker/TopBar";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { TtUpdateBanner } from "@/components/timetracker/UpdateBanner";
import { OfflineIndicator } from "@/components/timetracker/OfflineIndicator";
import type { Employee } from "@/lib/timetracker/types";
import "../timetracker.css";

// Same reason recruiting's layout overrides the root's browser-tab title
// (D-060) — inherited otherwise, and this module has nothing to do with
// deliveries or recruiting.
export const metadata: Metadata = {
  title: "RDZ Time Tracker",
};

// The timetracker module's own shell — a sibling of (app) and recruiting's
// (recruiting), never nested under either (D-064/D-066). Nothing from
// deliveries' layout is inherited on purpose: no deliveries DataProvider, no
// DriverGate/LocationTracker. Auth + profile fetch are duplicated instead of
// shared, matching the pattern (app)/layout.tsx and recruiting's layout
// already use independently of each other — this is the third, independent
// copy of that pattern, not a new one.
export default async function TimetrackerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient(); // deliveries' client — public schema, shared identity
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // ?next=/timetracker so login returns here, not the deliveries board — see
  // login/page.tsx and the D-076 note there. (middleware.ts's own next=
  // support turned out to be dead code: it lives at the repo root while this
  // app runs from src/, so Next.js never loads it — every route's real auth
  // gate has always been each layout's own check like this one, not
  // middleware. Not fixed here; a pre-existing, unrelated finding.)
  if (!user) redirect("/login?next=/timetracker");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_url, timetracker_role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  // No timetracker access at all — bounce to wherever this person actually
  // belongs, exactly like recruiting's own layout guard (D-052).
  if (!profile?.timetracker_role) {
    redirect(landingRoute({ role: profile?.role ?? "sales", module_access: profile?.module_access }));
  }

  // employee_settings (059) — the module-specific fields that don't live on
  // the shared profiles row (see D-066 on why they're a companion table, not
  // more columns on public.profiles). Absent for someone just granted access
  // who hasn't been configured yet — default in-memory rather than writing a
  // row nobody asked for.
  const { data: es } = await supabase
    .schema("timetracker")
    .from("employee_settings")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const me: Employee = {
    id: profile.id,
    fullName: profile.full_name ?? user.email ?? "Me",
    email: user.email ?? null,
    role: profile.timetracker_role as Employee["role"],
    city: es?.city ?? null,
    payMethod: es?.pay_method ?? null,
    payDetails: es?.pay_details ?? null,
    workerType: (es?.worker_type as Employee["workerType"]) ?? null,
    trackMode: (es?.track_mode as Employee["trackMode"]) ?? null,
    breaksEnabled: es?.breaks_enabled ?? null,
    active: es?.active ?? false,
    deletedAt: es?.deleted_at ?? null,
  };

  return (
    <div className="timetracker-module">
      <AppUpdateBanner app="timetracker" />
      <DataProvider me={me}>
        <div className="wrap">
          <TopBar deliveriesRole={profile.role} moduleAccess={profile.module_access} />
          <TtUpdateBanner />
          {children}
        </div>
      </DataProvider>
      <OfflineIndicator />
    </div>
  );
}
