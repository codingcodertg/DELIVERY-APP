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
    // Cada medio minuto: es un tablero que se mira, no una alarma, y un fichaje no cambia
    // cada segundo como sí lo hace el cronómetro.
    const id = setInterval(traer, 30_000);
    return () => { vivo = false; clearInterval(id); };
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
          <h2 style={{ margin: 0 }}>⏰ On the clock</h2>
          <span className="chip">{crew?.onClock.length ?? 0}</span>
        </div>
        {!crew ? (
          <div className="hint">Loading…</div>
        ) : crew.onClock.length === 0 ? (
          <p className="muted" style={{ marginTop: 12 }}>Nobody is punched in right now.</p>
        ) : (
          <table style={{ marginTop: 12 }}>
            <tbody>
              {crew.onClock.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="small muted nowrap">since {fmtTime(Date.parse(p.since))}</td>
                  <td className="nowrap" style={{ textAlign: "right" }}>
                    {fmtClock(Math.max(0, Math.floor((now - Date.parse(p.since)) / 1000)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.tab.live")}</h2>
        <span className="chip">{t("mgr.live.active", { n: rows.length + (crew?.onClock.length ?? 0) })}</span>
      </div>
      {rows.length === 0 && (crew?.onClock.length ?? 0) === 0 ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.live.empty")}</p>
      ) : (
        <div className="pbtns" style={{ marginTop: 12 }}>
          {/* Los que FICHAN, con la misma forma de tarjeta que los del cronómetro (D-129). En
              dos listas separadas parecían dos cosas distintas, y son la misma pregunta: quién
              está trabajando ahora. Lo que cambia es qué se puede medir de cada quien — de un
              fichaje no hay actividad, ni pantalla, ni inactivo, así que esas líneas no se
              dibujan en vez de dibujarse a cero, que sería inventarse un dato. */}
          {(crew?.onClock ?? []).map((p) => {
            const emp = uMap.get(p.employeeId);
            const desde = Date.parse(p.since);
            return (
              <div key={p.id} className="box">
                <div style={{ fontWeight: 700 }}>
                  {emp ? emp.fullName : p.name}
                  <span className="pill on" style={{ marginLeft: 6 }}>🏢 {t("mgr.live.inhouse")}</span>
                </div>
                <div className="small muted">{t("mgr.live.punched")}</div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="timer-big" style={{ fontSize: 26 }}>
                    {fmtClock(Math.max(0, Math.floor((now - desde) / 1000)))}
                  </span>
                  <span className="small muted" style={{ textAlign: "right" }}>
                    {t("mgr.live.since", { time: fmtTime(desde) })}
                  </span>
                </div>
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
              <div key={s.id} className="box">
                <div style={{ fontWeight: 700 }}>
                  {emp ? emp.fullName : (s.employeeName || "—")}
                  <span className="pill" style={{ marginLeft: 6, background: "var(--tt-accent)", color: "#fff" }}>
                    💻 {t("mgr.live.remote")}
                  </span>
                  {st ? <span className={"pill " + st.pill} style={{ marginLeft: 6 }}>{st.text}</span>
                    : <span className="pill on" style={{ marginLeft: 6 }}>{t("mgr.live.livePill")}</span>}
                </div>
                <div className="small muted">{proj ? proj.name : "—"}{s.memo ? " · " + s.memo : ""}</div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="timer-big" style={{ fontSize: 26 }}>{fmtClock(elapsed)}</span>
                  <span className="small muted" style={{ textAlign: "right" }}>
                    {t("mgr.live.activity", { pct })}<br />{t("mgr.live.since", { time: s.startMs ? fmtTime(s.startMs) : "—" })}
                  </span>
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  ⌨ {fmtClock(inputActive)} {t("mgr.live.wInput")} · 🖥 {fmtClock(screen)} {t("mgr.live.wScreen")} · 💤 {fmtClock(idle)} {t("mgr.live.wIdle")}
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
