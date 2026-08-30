"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { fmtClock, fmtTime } from "@/lib/timetracker/helpers";
import { getCrewNow } from "@/app/timetracker/clock-in/actions/clock";

// Ported (D-071) from timetracker-clean's manager/LiveMonitor.jsx — "who's
// working now", live via the provider's `liveSessions` (its own realtime
// channel, filtered to is_live=true — see the provider's block comment).
type Crew = Extract<Awaited<ReturnType<typeof getCrewNow>>, { ok: true }>;

export default function LiveMonitorPage() {
  const { me, liveSessions, allEmployees: users, allProjects: projects } = useData();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  // La otra mitad de "quién trabaja ahora" (D-128). Esta pantalla solo miraba `liveSessions`,
  // que son las sesiones del cronómetro: era CIEGA a quien está fichado. Con las dos formas de
  // trabajar conviviendo, respondía por media empresa sin decirlo — y por eso un admin fichaba
  // a alguien y no lo veía aparecer aquí.
  const [crew, setCrew] = useState<Crew | null>(null);
  useEffect(() => {
    let vivo = true;
    const traer = () => { void getCrewNow().then((r) => { if (vivo && r.ok) setCrew(r); }); };
    traer();
    // Cada 10 s, y no medio minuto como al principio: con 30 s se podía empezar el almuerzo,
    // terminarlo y volver a salir entre dos latidos, y el tablero enseñaba un estado que ya no
    // era cierto. Sigue siendo barato —una consulta pequeña— y ahora se siente en vivo.
    const id = setInterval(traer, 10_000);
    // Y al volver a la pestaña, ya: quien deja esto abierto en otra ventana y vuelve espera
    // ver lo de ahora, no lo de hace diez segundos.
    const alVolver = () => { if (!document.hidden) traer(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, []);

  const uMap = new Map(users.map((u) => [u.id, u]));
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const rows = liveSessions.slice().sort((a, b) => (a.startMs || 0) - (b.startMs || 0));

  function status(note: string | null) {
    if (!note) return null;
    if (note === "idle") return { pill: "wait", text: t("mgr.live.idle") };
    if (note === "break") return { pill: "wait", text: t("mgr.live.break") };
    if (note === "active") return { pill: "on", text: t("mgr.live.working") };
    return { pill: "on", text: "🟢 " + note };
  }

  if (me.role !== "admin") return <div className="card"><p className="muted">Admins only.</p></div>;

  const alertas = (crew?.late.length ?? 0) + (crew?.notInYet.length ?? 0);

  return (
    <>
      {/* Lo que necesita atención va ARRIBA: es lo único de esta pantalla sobre lo que hay que
          hacer algo, y era lo único que quedaba en el panel del módulo de fichaje. */}
      {alertas > 0 && (
        <div className="card">
          <h2 style={{ margin: 0 }}>⚠️ Needs attention</h2>
          <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
            {crew!.notInYet.map((a) => (
              <li key={"n" + a.name}><strong>{a.name}</strong> <span className="muted">has not clocked in</span></li>
            ))}
            {crew!.late.map((a) => (
              <li key={"l" + a.name}><strong>{a.name}</strong> <span className="muted">is {a.minutes} min late</span></li>
            ))}
          </ul>
        </div>
      )}

    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.tab.live")}</h2>
        <span className="chip">{t("mgr.live.active", { n: rows.length + (crew?.onClock.length ?? 0) })}</span>
      </div>
      {rows.length === 0 && (crew?.onClock.length ?? 0) === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.live.empty")}</p>
      ) : (
        <div className="live-grid">
          {/* Los que FICHAN, con la misma forma de tarjeta que los del cronómetro (D-129). En
              dos listas separadas parecían dos cosas distintas, y son la misma pregunta: quién
              está trabajando ahora. Lo que cambia es qué se puede medir de cada quien — de un
              fichaje no hay actividad, ni pantalla, ni inactivo, así que esas líneas no se
              dibujan en vez de dibujarse a cero, que sería inventarse un dato. */}
          {(crew?.onClock ?? []).map((p) => {
            const emp = uMap.get(p.employeeId);
            const desde = Date.parse(p.since);
            const fuera = p.away;
            return (
              <div key={p.id} className="live-card">
                <div className="live-name">{emp ? emp.fullName : p.name}</div>
                <div className="live-tags">
                  <span className="live-tag inhouse">🏢 {t("mgr.live.inhouse")}</span>
                  {/* Si salió, eso es LO que está haciendo ahora: manda sobre "fichado". */}
                  {fuera
                    ? <span className="live-tag away">{fuera.reason === "lunch" ? `🍽 ${t("mgr.live.onLunch")}` : `🚚 ${t("mgr.live.outNow")}`} · {fmtTime(Date.parse(fuera.since))}</span>
                    : <span className="live-tag state">{t("mgr.live.punched")}</span>}
                </div>
                <div className="live-sub">&nbsp;</div>
                <div className="live-clock">{fmtClock(Math.max(0, Math.floor((now - desde) / 1000)))}</div>
                <div className="live-meta">{t("mgr.live.clockIn")} {fmtTime(desde)}</div>
                {/* De un fichaje no hay actividad ni pantalla: la fila se reserva vacía para
                    que las dos tarjetas midan igual y no bailen una respecto a la otra. */}
                <div className="live-foot">&nbsp;</div>
              </div>
            );
          })}
          {rows.map((s) => {
            const emp = uMap.get(s.employeeUid);
            const proj = pMap.get(s.projectId ?? "");
            const elapsed = s.startMs ? Math.max(0, Math.floor((now - s.startMs) / 1000)) : (s.durationSeconds || 0);
            const dur = s.durationSeconds || 0;
            const pct = dur > 0 ? Math.round(((s.activeSeconds || 0) / dur) * 100) : 0;
            const screen = s.screenSeconds || 0;
            const inputActive = Math.max(0, (s.activeSeconds || 0) - screen);
            const idle = s.idleSeconds || 0;
            const st = status(s.liveNote);
            return (
              <div key={s.id} className="live-card">
                <div className="live-name">{emp ? emp.fullName : (s.employeeName || "—")}</div>
                <div className="live-tags">
                  <span className="live-tag remote">💻 {t("mgr.live.remote")}</span>
                  <span className="live-tag state">{st ? st.text : t("mgr.live.livePill")}</span>
                </div>
                <div className="live-sub">{proj ? proj.name : "—"}{s.memo ? " · " + s.memo : ""}</div>
                <div className="live-clock">{fmtClock(elapsed)}</div>
                <div className="live-meta">
                  {t("mgr.live.since", { time: s.startMs ? fmtTime(s.startMs) : "—" })} · {t("mgr.live.activity", { pct })}
                </div>
                <div className="live-foot">
                  ⌨ {fmtClock(inputActive)} · 🖥 {fmtClock(screen)} · 💤 {fmtClock(idle)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 10 }}>{t("mgr.live.foot")}</p>
    </div>
    </>
  );
}
