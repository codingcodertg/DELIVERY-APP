"use client";

import { useCallback, useEffect, useState } from "react";
import { getPendingForInbox, reviewTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import { resolveException } from "@/app/timetracker/clock-in/actions/exceptions";

/**
 * Las dos colas de fichaje dentro de la bandeja única (fusión de vistas #2).
 *
 * Reescrito, no mudado: los botones de fichaje son de Tailwind y esta pantalla vive bajo el
 * grupo (timetracker), cuyo chunk de CSS no incluye Tailwind. Las acciones de servidor sí
 * son las mismas —`reviewTimeOff` y `resolveException`— así que aprobar desde aquí y
 * aprobar desde la pantalla de fichaje hacen exactamente lo mismo, incluidos sus avisos.
 *
 * El alcance por tienda NO se decide aquí: lo resuelve `getPendingForInbox` con el mismo
 * `storeScope` que usan las pantallas de fichaje. Un gerente con tienda ve su cuadrilla y
 * nadie más, y esa regla vive en un solo sitio.
 */

type Off = { id: string; nombre: string; type: string; start_date: string; end_date: string; note: string | null };
type Exc = { id: string; nombre: string; type: string; reason: string | null; note: string | null; created_at: string };

const OFF_LABEL: Record<string, string> = {
  vacation: "Vacaciones",
  sick: "Enfermedad",
  schedule_change: "Cambio de horario",
  shift_swap: "Cambio de turno",
};
const EXC_LABEL: Record<string, string> = {
  out_of_radius: "Fuera del sitio",
  leaving_while_clocked_in: "Salió estando fichado",
  missed_punch: "Fichaje olvidado",
  other: "Otro",
};

export function ClockinApprovals({ onCount }: { onCount?: (n: number) => void }) {
  const [off, setOff] = useState<Off[]>([]);
  const [exc, setExc] = useState<Exc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getPendingForInbox();
    if (!res.ok) { setErr(res.message); setLoaded(true); return; }
    setErr(null);
    setOff(res.timeOff as Off[]);
    setExc(res.exceptions as Exc[]);
    setLoaded(true);
    onCount?.(res.timeOff.length + res.exceptions.length);
  }, [onCount]);

  useEffect(() => { void load(); }, [load]);

  // La fila desaparece al resolverse, así que se recarga en vez de quitarla a mano: si el
  // servidor la rechazó (otro gerente llegó antes), la lista vuelve con la verdad.
  async function act(id: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { setErr(res.message ?? "No se pudo aplicar."); return; }
    await load();
  }

  if (!loaded) return <div className="hint">Cargando…</div>;
  if (err) return <div className="banner err">{err}</div>;

  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>Ausencias y cambios de turno · Time off</h3>
      {off.length === 0 ? (
        <p className="small muted" style={{ marginTop: 0 }}>Nada pendiente.</p>
      ) : (
        <table className="orders">
          <thead><tr><th>Persona</th><th>Tipo</th><th>Fechas</th><th>Nota</th><th /></tr></thead>
          <tbody>
            {off.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td>{OFF_LABEL[r.type] ?? r.type}</td>
                <td>{r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}</td>
                <td className="small muted">{r.note || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-ok btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => reviewTimeOff({ id: r.id, decision: "approved" }))}>Aprobar</button>{" "}
                  <button className="btn-danger btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => reviewTimeOff({ id: r.id, decision: "denied" }))}>Rechazar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>Excepciones de fichaje · Exceptions</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Fichajes fuera del sitio, salidas sin volver y olvidos. No se aprueban: se revisan y se dan por vistos.
      </p>
      {exc.length === 0 ? (
        <p className="small muted">Nada pendiente.</p>
      ) : (
        <table className="orders">
          <thead><tr><th>Persona</th><th>Qué pasó</th><th>Motivo / nota</th><th>Cuándo</th><th /></tr></thead>
          <tbody>
            {exc.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td>{EXC_LABEL[r.type] ?? r.type}</td>
                <td className="small muted">{r.note || r.reason || "—"}</td>
                <td className="small muted">{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  <button className="btn-ghost btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => resolveException(r.id))}>Visto</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
