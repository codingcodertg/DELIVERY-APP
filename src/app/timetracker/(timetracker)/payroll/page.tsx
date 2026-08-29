import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PayrollTabs } from "@/components/timetracker/PayrollTabs";

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

/** El viernes del periodo que contiene esa fecha, en hora de la empresa. */
function periodStartOf(d: Date): string {
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const sinceFriday = (local.getDay() - 5 + 7) % 7;
  local.setDate(local.getDate() - sinceFriday);
  return local.toISOString().slice(0, 10);
}
function shift(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
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

  // Un grupo por tipo de trabajador. Son dos nóminas distintas en la práctica: al de sitio
  // se le paga la asistencia y al remoto lo cronometrado, así que mezclarlos en una tabla
  // obligaba a ir persona por persona recordando quién es cuál.
  const grupos: { titulo: string; nota: string; filas: Row[] }[] = [
    { titulo: "On site", nota: "paid from punches", filas: enSitio },
    { titulo: "Remote", nota: "paid from tracked sessions", filas: remotos },
  ].filter((g) => g.filas.length > 0);

  return (
    <PayrollTabs period={start}>
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Payroll · period</h2>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(start, -7)}`}>← previous</Link>
          <span className="chip">{start} → {shift(start, 6)}</span>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(start, 7)}`}>next →</Link>
        </div>
      </div>

      {error && <p className="muted" style={{ marginTop: 12 }}>Could not read the hours: {error.message}</p>}

      {aRevisar.length > 0 && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          {aRevisar.length === 1 ? "One person has" : `${aRevisar.length} people have`} both clock-in hours
          <strong> and </strong> project sessions this period. <strong>They are not added up:</strong> a session happens
          inside the punched shift, so adding them would pay the same stretch twice. Decide which one pays:{" "}
          {aRevisar.map((r) => r.full_name).join(", ")}.
        </div>
      )}

      {deducidos.size > 0 && (
        <div className="banner info" style={{ marginTop: 12 }}>
          {deducidos.size === 1 ? "One person has" : `${deducidos.size} people have`} no worker type set, so the group
          above is <strong>guessed</strong> from what they did this period. Set it once in{" "}
          <Link href="/timetracker/people">Employees</Link> and it stops being a guess.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>Nobody logged hours in this period.</p>
      ) : (
        <>
          {grupos.map((g) => (
            <div key={g.titulo} style={{ marginTop: 16 }}>
              <div className="section-title">
                {g.titulo} <span className="chip">{g.filas.length}</span>
                <span className="muted small" style={{ marginLeft: 8, fontWeight: 400 }}>{g.nota}</span>
              </div>
              <table className="orders" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th style={{ textAlign: "right" }}>Clock-in</th>
                    <th style={{ textAlign: "right" }}>Project</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {g.filas.map((r) => (
                    <tr key={r.employee_id}>
                      <td>
                        {r.full_name ?? "—"}
                        {deducidos.has(r.employee_id) && (
                          <span className="chip" style={{ marginLeft: 6 }} title="No worker type set — guessed from this period's hours. Set it in Employees.">guessed</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{num(r.horas_fichaje) > 0 ? `${num(r.horas_fichaje).toFixed(2)} h` : <span className="muted">—</span>}</td>
                      <td style={{ textAlign: "right" }}>{num(r.horas_proyecto) > 0 ? `${num(r.horas_proyecto).toFixed(2)} h` : <span className="muted">—</span>}</td>
                      <td>{r.revisar && <span className="pill wait">review</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td><strong>{g.titulo} subtotal</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{suma(g.filas, "horas_fichaje").toFixed(2)} h</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{suma(g.filas, "horas_proyecto").toFixed(2)} h</strong></td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}

          <table className="orders" style={{ marginTop: 18 }}>
            <tfoot>
              <tr>
                <td><strong>Everyone</strong></td>
                <td style={{ textAlign: "right" }}><strong>{totalFichaje.toFixed(2)} h</strong></td>
                <td style={{ textAlign: "right" }}><strong>{totalProyecto.toFixed(2)} h</strong></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </>
      )}

      <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Both halves count the week <strong>Friday to Thursday</strong>, so this period is the same in each. To approve
        timesheets, fix a punch or close the period, open <strong>Timesheets</strong> above — same period, no second
        calendar to keep in sync. The project-side detail is in{" "}
        <Link href="/timetracker/reports">Reports/Pay</Link>.
      </p>
    </div>
    </PayrollTabs>
  );
}
