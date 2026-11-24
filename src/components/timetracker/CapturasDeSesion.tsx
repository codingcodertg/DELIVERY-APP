"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { WorkDiary } from "@/components/timetracker/WorkDiary";
import { Modal } from "@/components/timetracker/Modal";
import { createClient } from "@/lib/timetracker/supabase/client";
import { rowToCamel } from "@/lib/timetracker/supabase/rowcase";
import { APP_SETTINGS, fmtHM } from "@/lib/timetracker/helpers";
import type { Screenshot, Session } from "@/lib/timetracker/types";

// Las capturas de escritorio de UNA sesión o de un día, en una ventana (2026-11-24). Sustituye a la
// sección «Capturas de escritorio» de Nómina: en la fila de un día (o de una sesión remota) el 🖥 abre
// esta ventana con sus fotos. Lo que se ve y cómo se borra es lo de siempre: `WorkDiary` en modo resumen,
// y el borrado de una captura resta su tramo de tiempo a la sesión (`deleteShot`, movido sin reescribir).
//
// La purga de más de 14 días (`mgr.shots.purgeBtn`) vive en el pie de la ventana: es global, no de una
// sesión, y no debía desaparecer con la sección que la traía.
//
// Demo y real: `LOCAL_MODE` elige. La versión demo no abre ningún cliente de Supabase (`modo-demo.test.ts`).
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export type CapturasDeSesionProps = {
  /** Nombre de la persona. */
  nombre: string;
  /** Lo que la identifica, p. ej. «Tue, Nov 24 · 8:03 AM – 10:12 AM». */
  etiqueta: string;
  /** Día con el que abre el diario (`YYYY-MM-DD`). Sin él, abre hoy. */
  dia?: string;
  /** Las sesiones cuyas capturas se muestran (`screenshots.session_id`). */
  sesionIds: string[];
  /** Esas mismas sesiones, para el total del día en la cabecera del diario. */
  sesiones: Session[];
  onCerrar: () => void;
  /** Se llama tras borrar una captura, para que quien tenga las sesiones las vuelva a leer. */
  onCambio?: () => void;
};

export function CapturasDeSesion(props: CapturasDeSesionProps) {
  return LOCAL_MODE ? <CapturasDemo {...props} /> : <CapturasReal {...props} />;
}

/**
 * Modo demo (sin base ni sesión): las capturas y sesiones salen del proveedor en memoria y aquí no se abre
 * ningún cliente de Supabase —la URL del demo es un marcador y cualquier consulta fallaría—. La purga no
 * existe en el demo: avisa y nada más. `modo-demo.test.ts` exige que esta función no nombre el cliente.
 */
function CapturasDemo({ sesionIds, onCambio, ...resto }: CapturasDeSesionProps) {
  const { myScreenshots, mySessions, deleteScreenshot, updateSession, notify } = useData();
  const t = useT();

  async function deleteShot(s: Screenshot) {
    const forfeitSeconds = (Number(APP_SETTINGS.screenshotIntervalMin) || 10) * 60;
    const msg = s.sessionId ? t("mgr.shots.delConfirm", { d: fmtHM(forfeitSeconds) }) : t("mgr.shots.delConfirmNoSess");
    if (!confirm(msg)) return;
    await deleteScreenshot(s.id, s.path);
    const sesion = s.sessionId ? mySessions.find((x) => x.id === s.sessionId) : null;
    if (sesion) {
      const dur = Math.max(0, sesion.durationSeconds - forfeitSeconds);
      await updateSession(sesion.id, { durationSeconds: dur, activeSeconds: Math.max(0, Math.min(sesion.activeSeconds, dur)) });
    }
    onCambio?.();
  }

  const shots = myScreenshots.filter((s) => !!s.sessionId && sesionIds.includes(s.sessionId));

  return (
    <CapturasVista
      {...resto}
      shots={shots}
      estado="ok"
      error=""
      onDelete={deleteShot}
      purging={false}
      purgeMsg=""
      onPurge={() => notify(t("mgr.shots.purgeNone"))}
    />
  );
}

function CapturasReal({ sesionIds, onCambio, ...resto }: CapturasDeSesionProps) {
  const t = useT();
  const supabase = useMemo(() => createClient(), []);
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando");
  const [error, setError] = useState("");
  const [purgeMsg, setPurgeMsg] = useState("");
  const [purging, setPurging] = useState(false);
  // Las ids como texto: el efecto corre cuando cambia la lista, no cuando el padre crea un array nuevo.
  const claves = sesionIds.join(",");

  // Las capturas de estas sesiones, en orden de toma. Sin sesiones, no hay nada que pedir.
  useEffect(() => {
    let cancelled = false;
    const ids = claves ? claves.split(",") : [];
    if (!ids.length) {
      setShots([]);
      setEstado("ok");
      return;
    }
    setEstado("cargando");
    supabase.from("screenshots").select("*").in("session_id", ids).order("taken_at", { ascending: true }).then(({ data, error: err }) => {
      if (cancelled) return;
      if (err) { setError(err.message); setEstado("error"); return; }
      setShots(((data as Record<string, unknown>[] | null) ?? []).map((r) => rowToCamel<Screenshot>(r)!));
      setEstado("ok");
    });
    return () => { cancelled = true; };
  }, [supabase, claves]);

  async function purge() {
    if (!confirm(t("mgr.shots.purgeConfirm"))) return;
    setPurging(true); setPurgeMsg("");
    try {
      const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
      const { data, error: err } = await supabase.from("screenshots").select("id,path").lt("taken_at", cutoff);
      if (err) throw err;
      const rows = data || [];
      if (rows.length) {
        const paths = rows.map((r) => r.path).filter(Boolean) as string[];
        if (paths.length) await supabase.storage.from("timetracker-screenshots").remove(paths);
        await supabase.from("screenshots").delete().lt("taken_at", cutoff);
      }
      setPurgeMsg(rows.length === 0 ? t("mgr.shots.purgeNone") : t("mgr.shots.purgeDone", { n: rows.length }));
    } catch (e) {
      const e2 = e as { message?: string } | null;
      setPurgeMsg(t("mgr.shots.purgeFail", { e: e2?.message || "unknown error" }));
    } finally { setPurging(false); }
  }

  // Delete a shot AND forfeit its ~segment of paid time (Upwork-style).
  async function deleteShot(s: Screenshot) {
    const segMin = Number(APP_SETTINGS.screenshotIntervalMin) || 10;
    const forfeitSeconds = segMin * 60;
    const msg = s.sessionId ? t("mgr.shots.delConfirm", { d: fmtHM(forfeitSeconds) }) : t("mgr.shots.delConfirmNoSess");
    if (!confirm(msg)) return;
    try {
      if (s.path) { try { await supabase.storage.from("timetracker-screenshots").remove([s.path]); } catch { /* best-effort */ } }
      await supabase.from("screenshots").delete().eq("id", s.id);
      if (s.sessionId && forfeitSeconds > 0) {
        const { data } = await supabase.from("sessions").select("duration_seconds,active_seconds").eq("id", s.sessionId).single();
        if (data) {
          const dur = Math.max(0, ((data.duration_seconds as number) || 0) - forfeitSeconds);
          const act = Math.max(0, Math.min((data.active_seconds as number) || 0, dur));
          await supabase.from("sessions").update({ duration_seconds: dur, active_seconds: act }).eq("id", s.sessionId);
        }
      }
      setShots((prev) => prev.filter((x) => x.id !== s.id));
      onCambio?.();
    } catch (e) {
      const err = e as { message?: string } | null;
      alert(t("mgr.shots.delFail", { e: err?.message || "unknown error" }));
    }
  }

  return (
    <CapturasVista
      {...resto}
      shots={shots}
      estado={estado}
      error={error}
      onDelete={deleteShot}
      purging={purging}
      purgeMsg={purgeMsg}
      onPurge={purge}
    />
  );
}

/** Lo que se pinta, igual en demo y en real. El guard de admin va aquí, como lo tenía el componente viejo. */
function CapturasVista({
  nombre, etiqueta, dia, sesiones, shots, estado, error, onDelete, onPurge, purging, purgeMsg, onCerrar,
}: Omit<CapturasDeSesionProps, "sesionIds" | "onCambio"> & {
  shots: Screenshot[];
  estado: "cargando" | "ok" | "error";
  error: string;
  onDelete: (s: Screenshot) => void;
  onPurge: () => void;
  purging: boolean;
  purgeMsg: string;
}) {
  const t = useT();
  const { me } = useData();
  const titulo = t("mgr.rep.capturas");

  if (me.role !== "admin") {
    return <Modal title={titulo} onClose={onCerrar}><p className="muted">{t("common.adminsOnly")}</p></Modal>;
  }

  return (
    <Modal title={titulo} onClose={onCerrar} maxWidth={960}>
      <p className="small muted" style={{ marginTop: 0 }}>{nombre} · {etiqueta}</p>

      {estado === "cargando" && <p className="muted" style={{ marginTop: 12 }}>{t("mgr.shots.loading")}</p>}
      {estado === "error" && <div className="banner info" style={{ marginTop: 12 }}>{t("mgr.shots.loadFail", { e: error })}</div>}
      {estado === "ok" && (shots.length === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.shots.noneSesion")}</p>
      ) : (
        <WorkDiary shots={shots} sessions={sesiones} onDelete={onDelete} summary diaInicial={dia || undefined} />
      ))}

      {purgeMsg && <div className="banner info" style={{ marginTop: 10 }}>{purgeMsg}</div>}

      <div className="between" style={{ marginTop: 14, alignItems: "center" }}>
        <p className="small muted" style={{ margin: 0 }}>
          {t("mgr.shots.foot", { d: fmtHM((Number(APP_SETTINGS.screenshotIntervalMin) || 10) * 60) })}
        </p>
        <button className="btn-ghost btn-sm" disabled={purging} onClick={onPurge}>{t("mgr.shots.purgeBtn")}</button>
      </div>
    </Modal>
  );
}
