import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignmentsTabs } from "@/components/timetracker/AssignmentsTabs";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

export const dynamic = "force-dynamic";

/**
 * Asignaciones: tarifas por proyecto Y el horario de la cuadrilla, en dos secciones (D-186).
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

  const { data: me, error: errorPerfil } = await supabase
    .from("profiles")
    .select("timetracker_role")
    .eq("id", user.id)
    .maybeSingle();
  // Igual que en los layouts (D-NEXT): una consulta que FALLA no manda a nadie a otro
  // sitio. Aqui el rebote es a /timetracker en vez de al login, asi que no hace bucle,
  // pero si hace lo otro: te saca de la pantalla que pediste sin decir por que.
  if (estadoDeLectura({ data: me, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }

  if (me?.timetracker_role !== "admin") redirect("/timetracker");

  return <AssignmentsTabs />;
}
