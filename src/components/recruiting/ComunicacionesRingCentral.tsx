"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import { fmtDateTime } from "@/lib/recruiting/utils";
import { CLAVE_DE_VELOCIDAD, rotuloDeVelocidad, siguienteVelocidad, velocidadGuardada } from "@/lib/recruiting/velocidad-de-audio";

/** Una llamada o un SMS de RingCentral, tal como la devuelve /api/recruiting/rc-comms (sin rutas de archivo). */
interface FilaRc {
  id: string;
  rc_id: string;
  kind: "call" | "sms";
  direction: "in" | "out";
  at: string;
  duration_s: number | null;
  result: string | null;
  body: string | null;
  phone: string;
  recording_pending: boolean;
  hasRecording: boolean;
}

function duracion(segundos: number | null): string {
  if (segundos == null) return "";
  const m = Math.floor(segundos / 60);
  const s = String(segundos % 60).padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Las llamadas y los SMS de RingCentral del candidato (la línea del dueño), debajo de Llamar/Texto en la ficha. Solo
 * para admin: la pantalla no decide el permiso, la API sí (401/403 la oculta). Las grabaciones se piden firmadas al
 * pulsar «Escuchar», nunca se incrustan en la lista.
 */
export function ComunicacionesRingCentral({ candidateId }: { candidateId: string }) {
  const { me } = useData();
  const { t } = usePrefs();
  const [filas, setFilas] = useState<FilaRc[] | null>(null);
  const [oculto, setOculto] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  // La velocidad, a la vista junto a cada grabación (como en WhatsApp) y la misma para todas; se recuerda en el navegador.
  const [velocidad, setVelocidad] = useState(1);
  useEffect(() => { try { setVelocidad(velocidadGuardada(localStorage.getItem(CLAVE_DE_VELOCIDAD))); } catch { /* sin almacenamiento: 1× */ } }, []);
  const cambiaVelocidad = () => setVelocidad((v) => { const n = siguienteVelocidad(v); try { localStorage.setItem(CLAVE_DE_VELOCIDAD, String(n)); } catch { /* da igual */ } return n; });
  const esAdmin = me?.role === "admin";

  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;
    setFilas(null);
    fetch(`/api/recruiting/rc-comms?candidate=${encodeURIComponent(candidateId)}`)
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          if (vivo) setOculto(true);
          return null;
        }
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then((j) => {
        if (vivo && j) setFilas((j.rows ?? []) as FilaRc[]);
      })
      .catch(() => {
        if (vivo) setFilas([]);
      });
    return () => {
      vivo = false;
    };
  }, [candidateId, esAdmin]);

  if (!esAdmin || oculto) return null;

  const escuchar = async (id: string) => {
    setError(null);
    try {
      const r = await fetch(`/api/recruiting/rc-comms/recording?id=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error("no url");
      setUrls((prev) => ({ ...prev, [id]: j.url as string }));
    } catch {
      setError(t("Could not load the recording.", "No se pudo cargar la grabación."));
    }
  };

  return (
    <div style={{ marginTop: 10 }} data-comunicaciones-ringcentral>
      <div style={{ fontSize: 11, color: "var(--gray)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 4 }}>
        {t("RingCentral calls and texts", "Llamadas y textos de RingCentral")}
      </div>
      {filas === null && <div className="hint">{t("Loading…", "Cargando…")}</div>}
      {filas !== null && filas.length === 0 && (
        <div className="hint">{t("No RingCentral calls or texts yet", "Aún no hay llamadas ni textos de RingCentral")}</div>
      )}
      {filas !== null && filas.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {filas.map((f) => (
            <li key={f.id} style={{ fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              <span aria-hidden="true">{f.kind === "call" ? "📞" : "💬"}</span>
              <span style={{ color: "var(--gray)" }}>{f.direction === "in" ? t("in", "entrante") : t("out", "saliente")}</span>
              <span>{fmtDateTime(f.at)}</span>
              {f.kind === "call" && f.duration_s != null && <span>{duracion(f.duration_s)}</span>}
              {f.kind === "call" && f.result && <span style={{ color: "var(--gray)" }}>{f.result}</span>}
              {f.kind === "sms" && f.body && <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>“{f.body}”</span>}
              {f.kind === "call" && f.recording_pending && !f.hasRecording && (
                <span className="hint">{t("Recording pending", "Grabación pendiente")}</span>
              )}
              {f.kind === "call" && f.hasRecording && !urls[f.id] && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => escuchar(f.id)}>
                  ▶ {t("Play", "Escuchar")}
                </button>
              )}
              {urls[f.id] && (
                <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", maxWidth: 420 }}>
                  <audio controls preload="none" src={urls[f.id]} style={{ flex: "1 1 auto", minWidth: 0 }}
                    ref={(el) => { if (el) el.playbackRate = velocidad; }} onPlay={(e) => { e.currentTarget.playbackRate = velocidad; }} />
                  <button type="button" data-velocidad-de-audio={velocidad} onClick={cambiaVelocidad} className={velocidad === 1 ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}
                    title={t("Playback speed: tap to change", "Velocidad: toque para cambiarla")} aria-label={t(`Playback speed ${rotuloDeVelocidad(velocidad)}`, `Velocidad ${rotuloDeVelocidad(velocidad)}`)}
                    style={{ flex: "0 0 auto", minWidth: 44, borderRadius: 999, fontWeight: 700 }}>
                    {rotuloDeVelocidad(velocidad)}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <div className="hint" style={{ color: "var(--red, #b91c1c)" }}>{error}</div>}
    </div>
  );
}
