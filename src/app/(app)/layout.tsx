import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { ConfirmProvider } from "@/lib/confirm";
import { LocalApp } from "@/components/LocalApp";
import { TopBar } from "@/components/TopBar";
import { VersionFooter } from "@/components/VersionFooter";
import { HelpButton } from "@/components/HelpButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverGate } from "@/components/DriverGate";
import { AssignmentPing } from "@/components/AssignmentPing";
import { PushRegistrar } from "@/components/PushRegistrar";
import { LocationTracker } from "@/components/LocationTracker";
import type { Profile } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Local demo mode: no Supabase, everything runs in the browser.
  if (LOCAL_MODE) return <ConfirmProvider><LocalApp>{children}</LocalApp></ConfirmProvider>;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // G-2 (D-NEXT): con ?next=, como erp/layout.tsx y timetracker/(timetracker)/layout.tsx. Un
  // layout de servidor no ve la ruta exacta; el middleware ya la guarda en `next` cuando es él
  // quien rebota (middleware.ts:167-171). Este es el rebote propio del layout, y su destino es
  // la raíz del grupo (app): el tablero, no /home. Ruta interna fija, así que no hay nada que
  // sanear; `safeNext` en el login la acepta tal cual.
  if (!user) redirect("/login?next=/");

  const { data: profile } = await supabase
    .from("profiles")
    // permissions + store come along because `me` is what every capability
    // check runs against — without them an admin's own extra grants and store
    // scope silently read as absent. recruiting_role + module_access are here
    // for the same reason: landingRoute() and the module selector need them.
    .select("id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  // A valid `user` but no `profile` row is a degraded session (RLS reading
  // this request as effectively anonymous — same class of bug as D-081,
  // just server-side/cookie-based instead of client-side), NOT a new user
  // with nothing to show yet: everyone with an account gets a profiles row
  // on signup. Silently fabricating role:"sales" here used to show a driver
  // (or anyone else) the sales board instead of their own view, with no
  // error anywhere. Bouncing to /login instead forces a real re-auth
  // instead of guessing an identity.
  if (!profile) redirect("/login?next=/");
  const me: Profile = profile;

  return (
    <ConfirmProvider>
      <DataProvider me={me}>
        <TopBar me={me} />
        {/* Buzzes the phone when a driver is handed a stop. Renders nothing. */}
        <AssignmentPing role={me.role} />
        {/* Records which phone to push to. Inert outside the APK. */}
        <PushRegistrar me={me} />
        {/* Position sharing for the whole shift. Must be mounted ABOVE the
            pages: on a single screen it stopped on every navigation. */}
        {me.role === "driver" && <LocationTracker me={me} />}
        {/* Drivers don't get in until their phone can actually report. Only
            they are gated: nobody else's work depends on background GPS, and
            the gate is inert outside the APK anyway. */}
        {me.role === "driver" ? (
          <DriverGate><div className="wrap"><ErrorBoundary role={me.role}>{children}</ErrorBoundary></div></DriverGate>
        ) : (
          <div className="wrap"><ErrorBoundary role={me.role}>{children}</ErrorBoundary></div>
        )}
        <HelpButton me={me} />
        <VersionFooter />
      </DataProvider>
    </ConfirmProvider>
  );
}
