"use client";

import { useCallback, useEffect, useState } from "react";
import { getPendingForInbox, reviewTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import { resolveException } from "@/app/timetracker/clock-in/actions/exceptions";
import { useT } from "@/lib/timetracker/i18n";

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
 *
 * G-9 (D-202): textos por claves mgr.inbox.*. Los tipos de tiempo libre y de excepción son
 * enumerados fijos del código (no configurables), así que su etiqueta es texto de pantalla y
 * se traduce; el valor crudo sigue de respaldo para un tipo que el mapa no conozca.
 */

type Off = { id: string; nombre: string; type: string; start_date: string; end_date: string; note: string | null };
type Exc = { id: string; nombre: string; type: string; reason: string | null; note: string | null; created_at: string };

// Claves literales, una por rama, para que la prueba de claves de D-187 las vea en el fuente.
function offLabel(t: ReturnType<typeof useT>, type: string): string {
  if (type === "vacation") return t("mgr.inbox.offVacation");
  if (type === "sick") return t("mgr.inbox.offSick");
  if (type === "schedule_change") return t("mgr.inbox.offScheduleChange");
  if (type === "shift_swap") return t("mgr.inbox.offShiftSwap");
  return type;
}
function excLabel(t: ReturnType<typeof useT>, type: string): string {
  if (type === "out_of_radius") return t("mgr.inbox.excOutOfRadius");
  if (type === "leaving_while_clocked_in") return t("mgr.inbox.excLeftClockedIn");
  if (type === "missed_punch") return t("mgr.inbox.excMissedPunch");
  if (type === "other") return t("mgr.inbox.excOther");
  return type;
}

export function ClockinApprovals({ onCount }: { onCount?: (n: number) => void }) {
  const t = useT();
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
    if (!res.ok) { setErr(res.message ?? t("mgr.inbox.applyFail")); return; }
    await load();
  }

  if (!loaded) return <div className="hint">{t("mgr.inbox.loading")}</div>;
  if (err) return <div className="banner err">{err}</div>;

  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("mgr.inbox.offTitle")}</h3>
      {off.length === 0 ? (
        <p className="small muted" style={{ marginTop: 0 }}>{t("mgr.inbox.nothingPending")}</p>
      ) : (
        <table className="orders">
          <thead><tr><th>{t("mgr.inbox.colPerson")}</th><th>{t("mgr.inbox.colType")}</th><th>{t("mgr.inbox.colDates")}</th><th>{t("mgr.inbox.colNote")}</th><th /></tr></thead>
          <tbody>
            {off.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td>{offLabel(t, r.type)}</td>
                <td>{r.start_date}{r.end_date !== r.start_date ? ` → ${r.end_date}` : ""}</td>
                <td className="small muted">{r.note || "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn-ok btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => reviewTimeOff({ id: r.id, decision: "approved" }))}>{t("mgr.inbox.approve")}</button>{" "}
                  <button className="btn-danger btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => reviewTimeOff({ id: r.id, decision: "denied" }))}>{t("mgr.inbox.deny")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("mgr.inbox.excTitle")}</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t("mgr.inbox.excNote")}
      </p>
      {exc.length === 0 ? (
        <p className="small muted">{t("mgr.inbox.nothingPending")}</p>
      ) : (
        <table className="orders">
          <thead><tr><th>{t("mgr.inbox.colPerson")}</th><th>{t("mgr.inbox.colWhat")}</th><th>{t("mgr.inbox.colReason")}</th><th>{t("mgr.inbox.colWhen")}</th><th /></tr></thead>
          <tbody>
            {exc.map((r) => (
              <tr key={r.id}>
                <td>{r.nombre}</td>
                <td>{excLabel(t, r.type)}</td>
                <td className="small muted">{r.note || r.reason || "—"}</td>
                <td className="small muted">{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  <button className="btn-ghost btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => resolveException(r.id))}>{t("mgr.inbox.markSeen")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
