import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import PullToRefresh from "@/components/clockin/PullToRefresh";
import "./clockin.css";

export const metadata: Metadata = {
  title: "RTG Clock-in",
};

/**
 * The clock-in module's shell.
 *
 * `data-app="clockin"` is load-bearing, not decoration: clockin.css scopes its resets to it, the
 * same way the ERP's layout does. The wrapper also carries the flex column its own root layout
 * used to put on <body>, which belongs to the shared root layout here.
 *
 * The access check mirrors recruiting's (D-051): reaching this layout is not, by itself, proof of
 * anything, so a direct URL is checked rather than trusted. Without it the database still refuses
 * every row — 074's policies see to that — but somebody typing /timetracker/clock-in/dashboard would get an
 * empty screen instead of being turned away, which reads as broken rather than closed.
 */
export default async function ClockInLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient(); // deliveries' client — public schema, shared identity
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/clock-in/clock");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, timetracker_role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  const role = profile?.role ?? "sales";
  // An admin is always in, matching public.has_clockin_access(): whoever grants module access
  // should not be able to lock themselves out of the module they administer.
  // El escalafón es el de Time Tracker desde 084; `clockin_role` se retiró en 087.
  const hasClockin = role === "admin" || !!profile?.timetracker_role;
  if (!hasClockin) {
    redirect(landingRoute({ role, module_access: profile?.module_access }));
  }

  return (
    <div data-app="clockin" className="flex min-h-screen flex-col">
      <PullToRefresh />
      {children}
    </div>
  );
}
