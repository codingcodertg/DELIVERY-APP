import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { landingRoute } from "@/lib/constants";
import { DataProvider } from "@/lib/timetracker-data-provider";
import { TopBar } from "@/components/timetracker/TopBar";
import { AppUpdateBanner } from "@/components/AppUpdateBanner";
import { TtUpdateBanner } from "@/components/timetracker/UpdateBanner";
import { OfflineIndicator } from "@/components/timetracker/OfflineIndicator";
import { CronometroAnfitrion } from "@/components/timetracker/CronometroAnfitrion";
import { CapacitacionProvider } from "@/components/timetracker/Capacitacion";
import { capacitacionDeLaPeticion } from "@/lib/timetracker/capacitacion-servidor";
import type { Employee } from "@/lib/timetracker/types";
import { resolverTiendaYPuesto } from "@/lib/timetracker/tienda-y-puesto";
import "../timetracker.css";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

// Same reason recruiting's layout overrides the root's browser-tab title
// (D-060) — inherited otherwise, and this module has nothing to do with
// deliveries or recruiting.
export const metadata: Metadata = {
  title: "RTG Time Tracker",
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
  // login/page.tsx and the D-076 note there. The middleware ALSO records the
  // exact path in `next` when it is the one bouncing (it has lived at
  // src/middleware.ts since D-119 and middleware-location.test.ts guards that);
  // this is the layout's own second gate, for a session the middleware let
  // through but that has no user here. (G-28, D-198: this comment used to say
  // the middleware was dead code at the repo root; that stopped being true in
  // D-119.)
  if (!user) redirect("/login?next=/timetracker");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_url, timetracker_role, module_access, store")
    .eq("id", user.id)
    .maybeSingle();
  // Tres desenlaces, no dos (D-234): si la CONSULTA fallo no se redirige, porque el
  // login vuelve aqui y el fallo se convierte en un bucle. Solo la fila ausente
  // —error nulo— sigue siendo la sesion degradada de D-081 que manda al login.
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }


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
  //
  // Junto a ella, en la misma ida, su tienda y su puesto de fichaje (D-NEXT): son el «proyecto» del
  // presencial y salen donde al remoto le sale el proyecto. Si estas dos lecturas fallan, la etiqueta
  // dice «sin tienda ni puesto» y nada más: no bloquean la entrada.
  const [{ data: es }, { data: ficha }, { data: sitios }] = await Promise.all([
    supabase.schema("timetracker").from("employee_settings").select("*").eq("id", user.id).maybeSingle(),
    supabase.schema("clockin").from("employee_settings").select("store_id, position").eq("id", user.id).maybeSingle(),
    supabase.schema("clockin").from("job_sites").select("id, name"),
  ]);
  const { tienda, puesto } = resolverTiendaYPuesto({
    fichaje: ficha,
    tiendas: new Map((sitios ?? []).map((s) => [s.id as string, s.name as string])),
    tiendaDelHub: profile.store,
  });

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
    tienda,
    puesto,
  };

  // Modo capacitación (D-490): la cookie se lee aquí para que la página llegue ya en práctica, con
  // su aviso, y no se pinte un instante «de verdad» antes de saberlo el navegador.
  const capacitacion = await capacitacionDeLaPeticion();

  return (
    <div className="timetracker-module">
      <AppUpdateBanner app="timetracker" />
      {/* Por FUERA del proveedor de datos: el proveedor pregunta por la práctica, y encenderla o
          apagarla lo vuelve a montar entero, con el cronómetro y cada pantalla. */}
      <CapacitacionProvider inicial={capacitacion} uid={me.id}>
        <DataProvider me={me}>
          <div className="wrap">
            <TopBar deliveriesRole={profile.role} moduleAccess={profile.module_access} />
            <TtUpdateBanner />
            {/* El cronómetro vive AQUÍ y no en su página (D-470): así el tick, el latido y el
                receptor de capturas siguen vivos en Capturas, Semana, Nómina… Antes morían al
                salir de «Registrar tiempo», sin avisar. Ver CronometroAnfitrion. */}
            <CronometroAnfitrion />
            {children}
          </div>
        </DataProvider>
      </CapacitacionProvider>
      <OfflineIndicator />
    </div>
  );
}
