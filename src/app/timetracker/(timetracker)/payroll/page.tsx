import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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

  const { data, error } = await supabase
    .schema("timetracker")
    .from("period_hours")
    .select("*")
    .eq("period_start", start)
    .order("full_name");

  const rows = (data ?? []) as Row[];
  const totalFichaje = rows.reduce((a, r) => a + num(r.horas_fichaje), 0);
  const totalProyecto = rows.reduce((a, r) => a + num(r.horas_proyecto), 0);
  const aRevisar = rows.filter((r) => r.revisar);

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>Nómina · periodo</h2>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(start, -7)}`}>← anterior</Link>
          <span className="chip">{start} → {shift(start, 6)}</span>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(start, 7)}`}>siguiente →</Link>
        </div>
      </div>

      {error && <p className="muted" style={{ marginTop: 12 }}>No se pudieron leer las horas: {error.message}</p>}

      {aRevisar.length > 0 && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          {aRevisar.length === 1 ? "Una persona tiene" : `${aRevisar.length} personas tienen`} fichaje
          <strong> y </strong> sesiones de proyecto este periodo. <strong>No se suman:</strong> una sesión ocurre dentro
          de la jornada fichada, así que sumarlas pagaría el mismo rato dos veces. Decide cuál paga:{" "}
          {aRevisar.map((r) => r.full_name).join(", ")}.
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>Nadie registró horas en este periodo.</p>
      ) : (
        <table className="orders" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Persona</th>
              <th style={{ textAlign: "right" }}>Fichaje</th>
              <th style={{ textAlign: "right" }}>Proyecto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee_id}>
                <td>{r.full_name ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{num(r.horas_fichaje) > 0 ? `${num(r.horas_fichaje).toFixed(2)} h` : <span className="muted">—</span>}</td>
                <td style={{ textAlign: "right" }}>{num(r.horas_proyecto) > 0 ? `${num(r.horas_proyecto).toFixed(2)} h` : <span className="muted">—</span>}</td>
                <td>{r.revisar && <span className="pill wait">revisar</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td style={{ textAlign: "right" }}><strong>{totalFichaje.toFixed(2)} h</strong></td>
              <td style={{ textAlign: "right" }}><strong>{totalProyecto.toFixed(2)} h</strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}

      <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Los dos módulos cuentan la semana de <strong>viernes a jueves</strong>, así que este periodo es el mismo
        en los dos. Para aprobar partes o cerrar el periodo, las pantallas de cada mitad siguen donde estaban:{" "}
        <Link href="/timetracker/reports">Reports/Pay</Link> y{" "}
        <Link href="/timetracker/clock-in/reports">Fichaje · nómina</Link>.
      </p>
    </div>
  );
}
