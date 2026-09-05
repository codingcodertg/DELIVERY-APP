import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PayrollTabs } from "@/components/timetracker/PayrollTabs";
import { periodStartOf } from "@/lib/timetracker/period";

export const dynamic = "force-dynamic";

/**
 * Las horas de las dos mitades de la app, por periodo de pago (fase 4 de la fusión).
 *
 * **No suma las dos columnas, y esa es la decisión de la pantalla.** Fichaje contesta
 * "¿estuviste?" y las sesiones "¿en qué?"; una sesión ocurre DENTRO de una jornada
 * fichada (9.32 h de media contra 1.46 h, D-102), así que sumarlas paga el mismo rato dos
 * veces. Elegir una en silencio es igual de malo al revés: a quien solo cronometra no se
 * le paga la asistencia, y a quien solo ficha no se le pagan las sesiones.
 *
 * Así que se enseñan por separado y se marca a quien tenga las dos. Hoy no le pasa a
 * nadie —la cuadrilla solo ficha, Nick solo cronometra— pero desde 084 las doce personas
 * tienen los dos módulos, así que puede empezar cualquier día. Cuando pase, lo decide una
 * persona mirando la fila, no una suma.
 *
 * El cálculo vive en `timetracker.period_hours` (086) y no aquí: si estuviera en la
 * pantalla, esta y la de nómina de fichaje derivarían en cuanto alguien tocara una de las
 * dos, y una nómina que no cuadra con la otra es peor que no tener la segunda.
 *
 * Desde D-NEXT esto ya no es una pestaña ("Period") sino la **cabecera** de Nómina: esta
 * página hace la misma consulta de siempre, calcula los totales y los avisos, y se los pasa
 * a `PayrollTabs`, que los pinta (`PayrollResumen`) encima de las dos secciones de pago. La
 * marca `revisar` por persona también sale de aquí, y no de una aproximación por tipo.
 */

type Row = {
  employee_id: string;
  full_name: string | null;
  period_start: string;
  period_end: string;
  horas_fichaje: string | number | null;
  horas_proyecto: string | number | null;
  revisar: boolean;
};

const num = (v: string | number | null) => (v == null ? 0 : typeof v === "number" ? v : parseFloat(v));

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/timetracker/payroll");

  const { data: me } = await supabase
    .from("profiles")
    .select("timetracker_role")
    .eq("id", user.id)
    .maybeSingle();
  // Las horas de todo el mundo son cosa de quien lleva la nómina.
  if (me?.timetracker_role !== "admin") redirect("/timetracker");

  const start = period && /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : periodStartOf(new Date());

  // El tipo de trabajador NO está en la vista `period_hours` y no se le añadió: esa vista
  // calcula horas y meterle un dato de configuración la ataría a una tabla que no necesita
  // para contar. Se junta aquí, que es donde importa para presentar.
  const [{ data, error }, { data: settingsRow }, { data: tipos }] = await Promise.all([
    supabase.schema("timetracker").from("period_hours").select("*").eq("period_start", start).order("full_name"),
    supabase.schema("timetracker").from("settings").select("data").eq("id", "app").maybeSingle(),
    supabase.schema("timetracker").from("employee_settings").select("id, worker_type"),
  ]);

  const puesto = new Map((tipos ?? []).map((t) => [t.id as string, (t.worker_type as string) || null]));
  const porDefecto =
    ((settingsRow?.data as { defaultWorkerType?: string } | null)?.defaultWorkerType) ?? "remote";

  const rows = (data ?? []) as Row[];

  /**
   * Quién es de sitio y quién remoto.
   *
   * Lo primero es lo que diga su ficha. Pero **tres de las trece personas no lo tienen
   * puesto**, y el valor por defecto de la empresa es "remoto": heredarlo a secas habría
   * metido en el grupo de remotos a gente con 21 fichajes y cero sesiones entre los tres
   * — es decir, habría enseñado exactamente lo contrario de la verdad, y con aire de dato.
   *
   * Así que a quien no lo tenga puesto se le mira lo que hizo en el periodo, que es un
   * hecho: si fichó y no cronometró nada, es de sitio. Si cronometró y no fichó, remoto. Si
   * hizo las dos cosas o ninguna, no hay nada que deducir y ahí sí manda el valor de la
   * empresa. Lo deducido se marca en la fila, para que se pueda dejar dicho de verdad en
   * Employees en vez de que la pantalla siga adivinando cada semana.
   */
  function tipoDe(r: Row): { tipo: "inhouse" | "remote"; deducido: boolean } {
    const fijado = puesto.get(r.employee_id);
    if (fijado === "inhouse" || fijado === "remote") return { tipo: fijado, deducido: false };
    const f = num(r.horas_fichaje) > 0;
    const p = num(r.horas_proyecto) > 0;
    if (f && !p) return { tipo: "inhouse", deducido: true };
    if (p && !f) return { tipo: "remote", deducido: true };
    return { tipo: porDefecto === "inhouse" ? "inhouse" : "remote", deducido: true };
  }
  const deducidos = new Set(rows.filter((r) => tipoDe(r).deducido).map((r) => r.employee_id));
  const enSitio = rows.filter((r) => tipoDe(r).tipo === "inhouse");
  const remotos = rows.filter((r) => tipoDe(r).tipo === "remote");
  const totalFichaje = rows.reduce((a, r) => a + num(r.horas_fichaje), 0);
  const totalProyecto = rows.reduce((a, r) => a + num(r.horas_proyecto), 0);
  const aRevisar = rows.filter((r) => r.revisar);

  const suma = (rs: Row[], k: "horas_fichaje" | "horas_proyecto") =>
    rs.reduce((a, r) => a + num(r[k]), 0);
  const nombre = (r: Row) => r.full_name ?? "—";

  return (
    <PayrollTabs
      period={start}
      revisar={aRevisar.map((r) => r.employee_id)}
      resumen={{
        start,
        error: error?.message ?? null,
        personas: rows.length,
        fichaje: { total: totalFichaje, enSitio: suma(enSitio, "horas_fichaje"), remotos: suma(remotos, "horas_fichaje") },
        proyecto: { total: totalProyecto, enSitio: suma(enSitio, "horas_proyecto"), remotos: suma(remotos, "horas_proyecto") },
        aRevisar: aRevisar.map(nombre),
        deducidos: rows.filter((r) => deducidos.has(r.employee_id)).map(nombre),
      }}
    />
  );
}
