"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { esAdmin } from "@/lib/impersonation";
import { leeEnsenanza } from "@/lib/boton-general";
import { ensenanzaDeLasCookies } from "@/lib/ensenanza-general";
import { appDeTutorial, nombreDeApp } from "@/lib/tutorials-hub";
import {
  CLAVE_APLAZADO, CLAVE_DESCARTADO, CLAVE_VISTO_EN_SESION, debeAvisar, leeVistos, marcaVisto, proximoAviso,
  tutorialesPendientes, type ClienteDeVistas,
} from "@/lib/tutorial-views";
import { ReproductorDeTutorial } from "@/components/tutorials/ReproductorDeTutorial";
import type { Tutorial } from "@/lib/types";

/**
 * «Tutoriales nuevos para ti» (D-NEXT): la tarjeta que sale al entrar al hub cuando hay videos de su rol que la
 * persona no ha marcado como vistos. Lista cada uno con «Ver ahora» (el video se abre aquí mismo, en la tarjeta)
 * y «Marcar como visto»; abajo «Recordar mañana» (hasta el día siguiente) y, solo al admin, «No volver a mostrar».
 * No hay cierre definitivo para los demás: vuelve cada día hasta que todo esté visto (lo pedido: «require users to
 * view new videos upon signing in»).
 *
 * Cuándo NO sale, en orden barato → caro: en modo enseñanza (D-626), si ya salió en esta sesión del navegador, si
 * está aplazada, si el admin la descartó; y después de preguntar a la base, si no hay pendientes o si la 267 aún no
 * está aplicada (la tabla ausente se lee como «no se puede saber», no como «no vio nada»).
 */
export function AvisoDeTutoriales({ me }: { me: { id: string; role: string | null | undefined } }) {
  const { t } = usePrefs();
  const admin = esAdmin(me.role);
  const [pendientes, setPendientes] = useState<Tutorial[] | null>(null);
  const [vistos, setVistos] = useState<Set<string>>(new Set());
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lee = (alm: "local" | "session", k: string): string | null => {
    try { return (alm === "local" ? window.localStorage : window.sessionStorage).getItem(k); } catch { return null; }
  };
  const escribe = (alm: "local" | "session", k: string, v: string) => {
    try { (alm === "local" ? window.localStorage : window.sessionStorage).setItem(k, v); } catch { /* sin almacenamiento */ }
  };

  useEffect(() => {
    let vivo = true;
    const ensenanza = ensenanzaDeLasCookies(document.cookie) !== null || leeEnsenanza(localStorage);
    const base = {
      ensenanza,
      yaAvisadoEnSesion: lee("session", CLAVE_VISTO_EN_SESION) === "1",
      aplazadoHasta: lee("local", CLAVE_APLAZADO),
      descartado: lee("local", CLAVE_DESCARTADO) === "1",
      esAdmin: admin,
      ahora: new Date(),
    };
    // Con `pendientes: 1` se prueban solo las puertas baratas: si alguna cierra, no se pregunta a la base.
    if (!debeAvisar({ ...base, pendientes: 1 })) return;
    void (async () => {
      const cliente = createClient();
      const [lista, v] = await Promise.all([cliente.rpc("tutorials"), leeVistos(cliente as unknown as ClienteDeVistas, me.id)]);
      if (!vivo || lista.error || !v.ok) return;
      const faltan = tutorialesPendientes((lista.data ?? []) as Tutorial[], v.vistos);
      if (!debeAvisar({ ...base, pendientes: faltan.length })) return;
      escribe("session", CLAVE_VISTO_EN_SESION, "1");
      setVistos(v.vistos);
      setPendientes(faltan);
    })();
    return () => { vivo = false; };
  }, [me.id, admin]);

  const aplazar = () => {
    escribe("local", CLAVE_APLAZADO, proximoAviso(new Date()).toISOString());
    setPendientes(null);
  };
  const descartar = () => {
    if (!admin) return;
    escribe("local", CLAVE_DESCARTADO, "1");
    setPendientes(null);
  };

  // Escape = «Recordar mañana»: cerrar sin decidir es aplazar, nunca descartar.
  useEffect(() => {
    if (!pendientes) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") aplazar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendientes]);

  if (!pendientes || pendientes.length === 0) return null;

  const marcar = async (id: string) => {
    setOcupado(id);
    const r = await marcaVisto(createClient() as unknown as ClienteDeVistas, me.id, id, new Date());
    setOcupado(null);
    if (!r.ok) {
      setError(r.motivo === "ensenanza"
        ? t("In teaching mode nothing is saved.", "En modo enseñanza no se guarda nada.")
        : t("Could not save. Try again.", "No se pudo guardar. Inténtalo otra vez."));
      return;
    }
    setError(null);
    const nuevos = new Set(vistos); nuevos.add(id);
    setVistos(nuevos);
    // Se queda en la lista, marcado, hasta que la persona cierre: así ve que quedó guardado. Si ya no falta nada, se cierra solo.
    if (pendientes.every((p) => nuevos.has(p.id))) setPendientes(null);
  };

  const faltan = pendientes.filter((p) => !vistos.has(p.id)).length;

  return (
    <div className="overlay" data-aviso-tutoriales onClick={aplazar}>
      <div className="modal hub-tarjeta" role="dialog" aria-modal="true" aria-labelledby="aviso-tutoriales-titulo" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3 id="aviso-tutoriales-titulo" style={{ margin: "0 0 4px" }}>🎬 {t("New tutorials for you", "Tutoriales nuevos para ti")}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {faltan === 1
            ? t("There is 1 video for your role you haven't watched yet.", "Hay 1 video para tu rol que aún no has visto.")
            : t(`There are ${faltan} videos for your role you haven't watched yet.`, `Hay ${faltan} videos para tu rol que aún no has visto.`)}
        </p>
        {error && <div className="hint" style={{ color: "var(--red)" }}>{error}</div>}
        <div style={{ display: "grid", gap: 6, maxHeight: "min(60vh, 520px)", overflowY: "auto" }}>
          {pendientes.map((tut) => {
            const visto = vistos.has(tut.id);
            return (
              <div key={tut.id} data-aviso-tutorial={tut.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                    <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tut.title}</b>
                    <span className="hint" style={{ margin: 0 }}>{nombreDeApp(appDeTutorial(tut), t)}</span>
                  </div>
                  {visto ? (
                    <span className="hint" data-tutorial-estado="visto" style={{ margin: 0, color: "var(--green, #1a7f4b)", fontWeight: 700 }}>✓ {t("Watched", "Visto")}</span>
                  ) : (
                    <>
                      <button type="button" className="btn btn-primary btn-sm" data-aviso-ver onClick={() => setAbierto((a) => (a === tut.id ? null : tut.id))} aria-expanded={abierto === tut.id}>
                        ▶ {abierto === tut.id ? t("Hide", "Ocultar") : t("Watch now", "Ver ahora")}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" data-aviso-marcar disabled={ocupado === tut.id} onClick={() => void marcar(tut.id)}>
                        {ocupado === tut.id ? "…" : `✓ ${t("Mark as watched", "Marcar como visto")}`}
                      </button>
                    </>
                  )}
                </div>
                {abierto === tut.id && !visto && (
                  <ReproductorDeTutorial tut={tut} visto={false} ocupado={ocupado === tut.id} onVisto={() => marcar(tut.id)} />
                )}
              </div>
            );
          })}
        </div>
        <div className="modal-actions" style={{ flexWrap: "wrap", gap: 8 }}>
          <Link href="/home/tutorials" className="btn btn-ghost btn-sm" style={{ marginRight: "auto" }}>{t("All tutorials", "Todos los tutoriales")}</Link>
          {admin && (
            <button type="button" className="btn btn-ghost btn-sm" data-aviso-descartar onClick={descartar}>
              {t("Don't show again", "No volver a mostrar")}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" data-aviso-aplazar onClick={aplazar}>
            {t("Remind me tomorrow", "Recordar mañana")}
          </button>
        </div>
      </div>
    </div>
  );
}
