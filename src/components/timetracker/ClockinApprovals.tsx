"use client";

import { TablaEstandar } from "@/components/TablaEstandar";
import { CalendarioDeAusencias } from "@/components/timetracker/CalendarioDeAusencias";
import { SeccionPlegable, useSeccionAbierta } from "@/components/timetracker/SeccionPlegable";
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
 * Desde D-1155 (ayuda de Roberto, 24 nov 2026) las dos colas están en secciones separadas que
 * la página coloca donde toca (ausencias arriba, excepciones abajo). Cargan los datos UNA
 * vez, en `useBandejaDeFichaje`, y las dos secciones leen de ahí: no hay dos llamadas a
 * `getPendingForInbox`.
 *
 * G-9 (D-202): textos por claves mgr.inbox.*. Los tipos de tiempo libre y de excepción son
 * enumerados fijos del código (no configurables), así que su etiqueta es texto de pantalla y
 * se traduce; el valor crudo sigue de respaldo para un tipo que el mapa no conozca.
 */

type Off = { id: string; nombre: string; type: string; start_date: string; end_date: string; note: string | null };
type Exc = { id: string; nombre: string; type: string; reason: string | null; note: string | null; created_at: string };
type Bandeja = ReturnType<typeof useBandejaDeFichaje>;

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

/**
 * Carga las dos colas una sola vez y las guarda. `activa` = false no pide nada (una persona sin
 * permiso de gerente no debe llamar a la acción). `onCount` recibe el total de las dos colas,
 * igual que el `onCount` del componente único de antes.
 */
export function useBandejaDeFichaje(opciones: { activa: boolean; onCount?: (n: number) => void }) {
  const { activa, onCount } = opciones;
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

  useEffect(() => { if (activa) void load(); }, [activa, load]);

  // La fila desaparece al resolverse, así que se recarga en vez de quitarla a mano: si el
  // servidor la rechazó (otro gerente llegó antes), la lista vuelve con la verdad.
  async function act(id: string, fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok) { setErr(res.message ?? t("mgr.inbox.applyFail")); return; }
    await load();
  }

  return { loaded, off, exc, err, busy, act };
}

/** Ausencias: la lista de solicitudes pendientes, o el calendario de quién falta. Empieza abierta si hay pendientes. */
export function SeccionAusenciasFichaje({ bandeja }: { bandeja: Bandeja }) {
  const t = useT();
  const { off, busy, act, loaded, err } = bandeja;
  const { abierta, alternar } = useSeccionAbierta("ausencias", true, off.length > 0);
  const [modo, setModo] = useState<"lista" | "calendario">("lista");

  return (
    <SeccionPlegable seccion="ausencias" titulo={t("mgr.inbox.offTitle")} cuenta={loaded ? off.length : null}
      abierta={abierta} alternar={alternar}>
      {!loaded ? <div className="hint">{t("mgr.inbox.loading")}</div>
        : err ? <div className="banner err">{err}</div>
        : (
          <>
            <div className="tt-calendario-modos">
              <button type="button" className="tt-calendario-modo" aria-pressed={modo === "lista"}
                onClick={() => setModo("lista")}>{t("mgr.inbox.viewList")}</button>
              <button type="button" className="tt-calendario-modo" aria-pressed={modo === "calendario"}
                onClick={() => setModo("calendario")}>{t("mgr.inbox.viewCalendar")}</button>
            </div>
            {modo === "calendario" ? <CalendarioDeAusencias /> : off.length === 0 ? (
              <p className="small muted" style={{ marginTop: 0 }}>{t("mgr.inbox.nothingPending")}</p>
            ) : (
              <TablaEstandar id="tt-bandeja-ausencias" filas={off} claveDe={(r) => String(r.id)} anchoDeAcciones={170}
                columnas={[
                  { key: "persona", en: t("mgr.inbox.colPerson"), es: t("mgr.inbox.colPerson"), ancho: 200, fija: true, valor: (r) => r.nombre },
                  { key: "tipo", en: t("mgr.inbox.colType"), es: t("mgr.inbox.colType"), ancho: 170, valor: (r) => offLabel(t, r.type) },
                  { key: "fechas", en: t("mgr.inbox.colDates"), es: t("mgr.inbox.colDates"), ancho: 230,
                    valor: (r) => r.start_date + (r.end_date !== r.start_date ? " → " + r.end_date : "") },
                  { key: "nota", en: t("mgr.inbox.colNote"), es: t("mgr.inbox.colNote"), ancho: 260, clase: "small muted", envuelve: true, valor: (r) => r.note || null },
                ]}
                acciones={(r) => (
                  <>
                    <button className="btn-ok btn-sm" disabled={busy === r.id}
                      onClick={() => act(r.id, () => reviewTimeOff({ id: r.id, decision: "approved" }))}>{t("mgr.inbox.approve")}</button>{" "}
                    <button className="btn-danger btn-sm" disabled={busy === r.id}
                      onClick={() => act(r.id, () => reviewTimeOff({ id: r.id, decision: "denied" }))}>{t("mgr.inbox.deny")}</button>
                  </>
                )} />
            )}
          </>
        )}
    </SeccionPlegable>
  );
}

/** Excepciones de fichaje: se marcan como vistas, no se aprueban. Empieza cerrada. */
export function SeccionExcepcionesFichaje({ bandeja }: { bandeja: Bandeja }) {
  const t = useT();
  const { exc, busy, act, loaded, err } = bandeja;
  const { abierta, alternar } = useSeccionAbierta("excepciones", false, exc.length > 0);

  return (
    <SeccionPlegable seccion="excepciones" titulo={t("mgr.inbox.excTitle")} cuenta={loaded ? exc.length : null}
      abierta={abierta} alternar={alternar}>
      {!loaded ? <div className="hint">{t("mgr.inbox.loading")}</div>
        : err ? <div className="banner err">{err}</div>
        : (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              {t("mgr.inbox.excNote")}
            </p>
            {exc.length === 0 ? (
              <p className="small muted">{t("mgr.inbox.nothingPending")}</p>
            ) : (
              <TablaEstandar id="tt-bandeja-excepciones" filas={exc} claveDe={(r) => String(r.id)} anchoDeAcciones={140}
                columnas={[
                  { key: "persona", en: t("mgr.inbox.colPerson"), es: t("mgr.inbox.colPerson"), ancho: 200, fija: true, valor: (r) => r.nombre },
                  { key: "que", en: t("mgr.inbox.colWhat"), es: t("mgr.inbox.colWhat"), ancho: 200, valor: (r) => excLabel(t, r.type) },
                  { key: "motivo", en: t("mgr.inbox.colReason"), es: t("mgr.inbox.colReason"), ancho: 280, clase: "small muted", envuelve: true, valor: (r) => r.note || r.reason || null },
                  { key: "cuando", en: t("mgr.inbox.colWhen"), es: t("mgr.inbox.colWhen"), ancho: 180, clase: "small muted", valor: (r) => r.created_at,
                    celda: (r) => new Date(r.created_at).toLocaleString() },
                ]}
                acciones={(r) => (
                  <button className="btn-ghost btn-sm" disabled={busy === r.id}
                    onClick={() => act(r.id, () => resolveException(r.id))}>{t("mgr.inbox.markSeen")}</button>
                )} />
            )}
          </>
        )}
    </SeccionPlegable>
  );
}
