import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ScheduleWeek } from "@/components/timetracker/ScheduleWeek";

export const dynamic = "force-dynamic";

/**
 * El horario de la cuadrilla (D-121), quinta pantalla que baja del módulo de fichaje.
 *
 * La puerta es la misma que la de Payroll y por el mismo motivo: el horario de todo el mundo
 * es cosa de quien lleva la cuadrilla, no de cada persona. Quien solo quiere ver el suyo lo
 * tiene en "My Week" y en la pantalla de fichar.
 */
export default async function SchedulePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/schedule");

  const { data: me } = await supabase
    .from("profiles")
    .select("timetracker_role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.timetracker_role !== "admin") redirect("/timetracker");

  return <ScheduleWeek />;
}
