import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignmentsTabs } from "@/components/timetracker/AssignmentsTabs";

export const dynamic = "force-dynamic";

/**
 * Asignaciones: tarifas por proyecto Y el horario de la cuadrilla, en dos secciones (D-NEXT).
 *
 * La puerta es la que tenía el Horario (D-121), heredada a su vez de Payroll: se comprueba el
 * rol en el SERVIDOR y se redirige antes de montar nada. La pantalla de asignaciones la
 * comprobaba en el navegador y montaba la página igual, enseñando "Admins only"; al fundirlas
 * se queda la fuerte. Quien solo quiere ver su horario lo tiene en "My Week" y al fichar.
 */
export default async function AssignmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/assignments");

  const { data: me } = await supabase
    .from("profiles")
    .select("timetracker_role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.timetracker_role !== "admin") redirect("/timetracker");

  return <AssignmentsTabs />;
}
