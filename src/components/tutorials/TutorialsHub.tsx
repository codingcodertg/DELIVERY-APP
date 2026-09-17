"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { tutorialEmbed } from "@/lib/tutorials";
import {
  agrupaTutoriales, APPS_DE_TUTORIAL, guardaTutoriales, nuevoTutorial,
  type ClienteDeAjustes, type GrupoDeTutoriales,
} from "@/lib/tutorials-hub";
import type { Tutorial, TutorialApp } from "@/lib/types";

/**
 * Los tutoriales del hub (D-268). Es la sección que vivía en la «Cuenta» de Entregas, movida: la
 * misma vista del video y el mismo formulario, ahora agrupados por app y con buscador.
 *
 * **Se lee de `public.tutorials()` (113), no de `settings`.** La 100 cierra `settings` a quien tiene
 * Entregas, y esta página es de todo el mundo. La función devuelve solo lo que se pinta.
 */
export function TutorialsHub({ yo, puedeGestionar }: { yo: string | null; puedeGestionar: boolean }) {
  const { t } = usePrefs();
  const [lista, setLista] = useState<Tutorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const cargar = useCallback(async () => {
    const { data, error: e } = await createClient().rpc("tutorials");
    // El error se ENSEÑA: una lista vacía y muda se lee como «no hay tutoriales».
    if (e) { setError(e.message); setLista([]); return; }
    setError(null);
    setLista((data ?? []) as Tutorial[]);
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const grupos = useMemo(() => agrupaTutoriales(lista ?? [], busca), [lista, busca]);

  const nombreApp = (app: GrupoDeTutoriales["app"]) => {
    switch (app) {
      case "deliveries": return t("Deliveries", "Entregas");
      case "recruiting": return t("HR", "RR. HH.");
      case "timetracker": return "Time Tracker";
      case "clockin": return t("Clock-in", "Fichaje");
      case "erp": return "ERP";
      default: return "General";
    }
  };

  const guardar = async (cambio: (actual: Tutorial[]) => Tutorial[]) => {
    const r = await guardaTutoriales(createClient() as unknown as ClienteDeAjustes, cambio);
    if (!r.ok) {
      setError(
        r.motivo === "sin_permiso"
          ? t("Only an admin can change tutorials.", "Solo un admin puede cambiar los tutoriales.")
          : t("Could not save. Try again.", "No se pudo guardar. Inténtalo otra vez."),
      );
      return false;
    }
    await cargar();
    return true;
  };

  const quitar = async (id: string) => {
    if (!confirm(t("Remove this tutorial?", "¿Eliminar este tutorial?"))) return;
    await guardar((actual) => actual.filter((x) => x.id !== id));
  };

  return (
    <>
      <div className="page-head">
        <h2>🎬 {t("Tutorials", "Tutoriales")}</h2>
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
      </div>

      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>
          {t("Short how-to videos for every app.", "Videos cortos de cómo usar cada app.")}
        </p>
        <input
          className="inp"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder={t("Search a video by title…", "Buscar un video por título…")}
        />
      </div>

      {puedeGestionar && yo && <AnadirTutorial yo={yo} guardar={guardar} />}

      {error && <div className="card"><div className="hint" style={{ color: "var(--red)" }}>{error}</div></div>}

      {lista === null ? (
        <div className="card"><div className="hint">{t("Loading…", "Cargando…")}</div></div>
      ) : grupos.length === 0 ? (
        <div className="card">
          <div className="hint">
            {busca.trim() ? t("No video matches that.", "Ningún video coincide con eso.") : t("No tutorials yet.", "Aún no hay tutoriales.")}
          </div>
        </div>
      ) : (
        grupos.map((g) => (
          <div className="card" key={g.app}>
            <h2 style={{ marginTop: 0 }}>{nombreApp(g.app)}</h2>
            <div style={{ display: "grid", gap: 18 }}>
              {g.tutoriales.map((tut) => (
                <VideoTutorial key={tut.id} tut={tut} onQuitar={puedeGestionar ? () => quitar(tut.id) : undefined} />
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}

function AnadirTutorial({ yo, guardar }: { yo: string; guardar: (cambio: (actual: Tutorial[]) => Tutorial[]) => Promise<boolean> }) {
  const { t } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [app, setApp] = useState<TutorialApp | "general">("general");
  const [ocupado, setOcupado] = useState(false);

  const reset = () => { setTitle(""); setUrl(""); setDesc(""); setApp("general"); setAbierto(false); };
  const nombreApp = (a: TutorialApp | "general") =>
    ({ deliveries: t("Deliveries", "Entregas"), recruiting: t("HR", "RR. HH."), timetracker: "Time Tracker",
       clockin: t("Clock-in", "Fichaje"), erp: "ERP", general: "General" })[a];

  const anadir = async () => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item = nuevoTutorial({ title, url, description: desc, app }, { id: yo }, new Date(), id);
    if (!item) return;
    setOcupado(true);
    const ok = await guardar((actual) => [...actual, item]);
    setOcupado(false);
    if (ok) reset();
  };

  if (!abierto) {
    return (
      <div className="card">
        <button className="btn btn-primary btn-sm" onClick={() => setAbierto(true)}>＋ {t("Add tutorial", "Agregar tutorial")}</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="field">
        <label>{t("Title", "Título")}</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. How to create an order", "ej. Cómo crear una orden")} />
      </div>
      <div className="field">
        <label>{t("Video link (YouTube, Loom, Vimeo, Drive)", "Enlace del video (YouTube, Loom, Vimeo, Drive)")}</label>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </div>
      <div className="field">
        <label>{t("App", "App")}</label>
        <select value={app} onChange={(e) => setApp(e.target.value as TutorialApp | "general")}>
          {[...APPS_DE_TUTORIAL, "general" as const].map((a) => <option key={a} value={a}>{nombreApp(a)}</option>)}
        </select>
      </div>
      <div className="field">
        <label>{t("Description (optional)", "Descripción (opcional)")}</label>
        <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={reset}>{t("Cancel", "Cancelar")}</button>
        <button className="btn btn-primary btn-sm" onClick={anadir} disabled={ocupado || !title.trim() || !url.trim()}>
          {ocupado ? "…" : t("Add", "Agregar")}
        </button>
      </div>
    </div>
  );
}

/** Un video: su título, su descripción y el reproductor que toque según el enlace. */
function VideoTutorial({ tut, onQuitar }: { tut: Tutorial; onQuitar?: () => void }) {
  const { t } = usePrefs();
  const em = tutorialEmbed(tut.url);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <b style={{ fontFamily: "Archivo, sans-serif", fontSize: 16 }}>{tut.title}</b>
        {onQuitar && (
          <button className="btn btn-ghost btn-sm" title={t("Remove", "Quitar")} onClick={onQuitar}>✕</button>
        )}
      </div>
      {tut.description && <div className="hint" style={{ marginTop: 2 }}>{tut.description}</div>}
      <div style={{ marginTop: 8 }}>
        {em.kind === "iframe" ? (
          <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 10, overflow: "hidden", background: "#000" }}>
            <iframe
              src={em.src}
              title={tut.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
        ) : em.kind === "file" ? (
          <video src={em.src} controls style={{ width: "100%", borderRadius: 10, background: "#000" }} />
        ) : (
          <a className="btn btn-ghost btn-sm" href={em.src} target="_blank" rel="noopener noreferrer">▶ {t("Open video", "Abrir video")}</a>
        )}
      </div>
    </div>
  );
}
