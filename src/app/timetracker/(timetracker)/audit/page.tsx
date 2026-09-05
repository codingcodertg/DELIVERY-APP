import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuditTabs } from "@/components/timetracker/AuditTabs";

/**
 * Auditoría: puerta de SERVIDOR (D-194), calcada de `assignments/page.tsx` (D-186).
 *
 * Hasta ahora la puerta era un `if (me.role !== "admin")` en el navegador, tras montar y
 * consultar. Con la cuarta vista entra una acción que resta tiempo pagado (borrar una captura
 * de escritorio), y para eso el `if` del cliente no basta: RLS es quien protege de verdad, y
 * esta redirección evita además pintar la pantalla a quien no debe verla. El cuerpo, con el
 * selector de vistas, es `AuditTabs` (cliente).
 */
export default async function AuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/audit");

  const { data: me } = await supabase
    .from("profiles")
    .select("timetracker_role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.timetracker_role !== "admin") redirect("/timetracker");

  return <AuditTabs />;
}
