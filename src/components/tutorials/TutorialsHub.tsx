"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { tutorialEmbed } from "@/lib/tutorials";
import {
  agrupaTutoriales, APPS_DE_TUTORIAL, cambiaApp, editaTutorial, guardaTutoriales, nuevoTutorial,
  rolesDesconocidos, rolesParaApp, soloLoVeElAdmin, vocabularioDe,
  type ClienteDeAjustes, type GrupoDeTutoriales,
} from "@/lib/tutorials-hub";
import type { Tutorial, TutorialApp } from "@/lib/types";

/**
 * Los tutoriales del hub (D-268). Es la sección que vivía en la «Cuenta» de Entregas, movida, agrupada
 * por app y con buscador.
 *
 * **Se lee de `public.tutorials()`, no de `settings`.** La 100 cierra `settings` a quien tiene Entregas,
 * y esta página es de todo el mundo. La función decide además **para quién es cada video** (114, y por
 * app desde la 115): a esta pantalla solo le llegan los que quien mira puede ver.
 *
 * Compacta desde D-NEXT: una fila por video, con el reproductor plegado; solo uno abierto a la vez.
 */

type Entrada = { title: string; url: string; description: string; app: TutorialApp | "general"; roles: string[] };

export function TutorialsHub({ yo, puedeGestionar }: { yo: string | null; puedeGestionar: boolean }) {
  const { t } = usePrefs();
  const [lista, setLista] = useState<Tutorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [anadiendo, setAnadiendo] = useState(false);

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

  const anadir = async (e: Entrada) => {
    if (!yo) return false;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item = nuevoTutorial(e, { id: yo }, new Date(), id);
    if (!item) return false;
    const ok = await guardar((actual) => [...actual, item]);
    if (ok) setAnadiendo(false);
    return ok;
  };

  const editar = async (id: string, e: Entrada) => {
    // Se edita sobre lo que HAY en la base (guardaTutoriales relee), no sobre la fila de la pantalla.
    const ok = await guardar((actual) => editaTutorial(actual, id, e) ?? actual);
    if (ok) setEditando(null);
    return ok;
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

      <div className="card" style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="inp"
            style={{ flex: "1 1 220px" }}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("Search a video by title…", "Buscar un video por título…")}
          />
          {puedeGestionar && yo && !anadiendo && (
            <button className="btn btn-primary btn-sm" onClick={() => setAnadiendo(true)}>＋ {t("Add tutorial", "Agregar tutorial")}</button>
          )}
        </div>
      </div>

      {puedeGestionar && yo && anadiendo && (
        <div className="card" style={{ padding: "10px 14px" }}>
          <FormularioTutorial onGuardar={anadir} onCancelar={() => setAnadiendo(false)} />
        </div>
      )}

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
          <div className="card" key={g.app} style={{ padding: "8px 14px" }}>
            <div className="section-label" style={{ marginTop: 2, marginBottom: 4 }}>{nombreApp(g.app)}</div>
            {g.tutoriales.map((tut) =>
              editando === tut.id ? (
                <div key={tut.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
                  <FormularioTutorial inicial={tut} onGuardar={(e) => editar(tut.id, e)} onCancelar={() => setEditando(null)} />
                </div>
              ) : (
                <FilaTutorial
                  key={tut.id}
                  tut={tut}
                  abierto={abierto === tut.id}
                  onAlternar={() => setAbierto((a) => (a === tut.id ? null : tut.id))}
                  gestion={puedeGestionar ? { onEditar: () => { setEditando(tut.id); setAbierto(null); }, onQuitar: () => quitar(tut.id) } : undefined}
                />
              ),
            )}
          </div>
        ))
      )}
    </>
  );
}

/**
 * Añadir o editar: el mismo formulario. Las casillas son los roles DE LA APP elegida, y al cambiar de app
 * se quitan los que no son de la nueva y se dice cuáles (D-NEXT).
 */
function FormularioTutorial({ inicial, onGuardar, onCancelar }: {
  inicial?: Tutorial;
  onGuardar: (e: Entrada) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const { t, lang } = usePrefs();
  const appInicial: TutorialApp | "general" = inicial?.app && APPS_DE_TUTORIAL.includes(inicial.app) ? inicial.app : "general";
  const [title, setTitle] = useState(inicial?.title ?? "");
  const [url, setUrl] = useState(inicial?.url ?? "");
  const [desc, setDesc] = useState(inicial?.description ?? "");
  const [app, setApp] = useState<TutorialApp | "general">(appInicial);
  // Al abrir, solo los roles que son de su app: los demás se avisan abajo y se van al guardar.
  const [roles, setRoles] = useState<string[]>(rolesParaApp(appInicial, inicial?.roles));
  const [quitados, setQuitados] = useState<string[]>(rolesDesconocidos(appInicial, inicial?.roles));
  const [ocupado, setOcupado] = useState(false);

  const vocabulario = vocabularioDe(app);
  const nombreApp = (a: TutorialApp | "general") =>
    ({ deliveries: t("Deliveries", "Entregas"), recruiting: t("HR", "RR. HH."), timetracker: "Time Tracker",
       clockin: t("Clock-in", "Fichaje"), erp: "ERP", general: "General" })[a];

  const elegirApp = (nueva: TutorialApp | "general") => {
    const r = cambiaApp(roles, nueva);
    setApp(nueva);
    setRoles(r.roles);
    setQuitados((prev) => [...new Set([...prev, ...r.quitados])]);
  };

  const enviar = async () => {
    setOcupado(true);
    await onGuardar({ title, url, description: desc, app, roles });
    setOcupado(false);
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="grid g2" style={{ gap: 8 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>{t("Title", "Título")}</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. How to create an order", "ej. Cómo crear una orden")} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>{t("Video link (YouTube, Loom, Vimeo, Drive)", "Enlace del video (YouTube, Loom, Vimeo, Drive)")}</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </div>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>{t("App", "App")}</label>
        <select value={app} onChange={(e) => elegirApp(e.target.value as TutorialApp | "general")}>
          {[...APPS_DE_TUTORIAL, "general" as const].map((a) => <option key={a} value={a}>{nombreApp(a)}</option>)}
        </select>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>{t("Who is it for? (none = everyone)", "¿Para quién? (ninguno = todos)")}</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {vocabulario.claves.map((r) => (
            <label key={r} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={roles.includes(r)}
                onChange={(e) => setRoles((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)))}
              />
              {vocabulario.etiqueta(r, lang)}
            </label>
          ))}
        </div>
        {quitados.length > 0 && (
          <div className="hint" style={{ marginTop: 4, color: "var(--red)" }}>
            {t(
              `These roles are not from this app and will be removed when you save: ${quitados.join(", ")}`,
              `Estos roles no son de esta app y se quitan al guardar: ${quitados.join(", ")}`,
            )}
          </div>
        )}
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>{t("Description (optional)", "Descripción (opcional)")}</label>
        <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
        <button className="btn btn-primary btn-sm" onClick={enviar} disabled={ocupado || !title.trim() || !url.trim()}>
          {ocupado ? "…" : inicial ? t("Save", "Guardar") : t("Add", "Agregar")}
        </button>
      </div>
    </div>
  );
}

/** Una fila: título y para quién. El reproductor se abre al tocar. */
function FilaTutorial({ tut, abierto, onAlternar, gestion }: {
  tut: Tutorial;
  abierto: boolean;
  onAlternar: () => void;
  gestion?: { onEditar: () => void; onQuitar: () => void };
}) {
  const { t, lang } = usePrefs();
  const vocabulario = vocabularioDe(tut.app);
  const suyos = rolesParaApp(tut.app, tut.roles);
  const desconocidos = gestion ? rolesDesconocidos(tut.app, tut.roles) : [];

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onAlternar}
          aria-expanded={abierto}
          style={{ flex: 1, justifyContent: "flex-start", textAlign: "left", minWidth: 0 }}
        >
          <span>{abierto ? "▾" : "▸"}</span>
          <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tut.title}</b>
          {suyos.length > 0 && (
            <span className="hint" style={{ fontWeight: 400, whiteSpace: "nowrap" }}>
              · {suyos.map((r) => vocabulario.etiqueta(r, lang).split(" — ")[0]).join(", ")}
            </span>
          )}
        </button>
        {gestion && (
          <>
            <button className="btn btn-ghost btn-sm" onClick={gestion.onEditar}>{t("Edit", "Editar")}</button>
            <button className="btn btn-ghost btn-sm" title={t("Remove", "Quitar")} onClick={gestion.onQuitar}>✕</button>
          </>
        )}
      </div>
      {desconocidos.length > 0 && (
        <div className="hint" style={{ color: "var(--red)", marginLeft: 8 }}>
          ⚠ {soloLoVeElAdmin(tut.app, tut.roles)
            ? t("Only admins can see this video: its roles are not from its app", "Este video solo lo ven los admins: sus roles no son de su app")
            : t("Some roles are not from this app", "Algunos roles no son de esta app")}
          {`: ${desconocidos.join(", ")}. `}
          {t("Edit and save to remove them.", "Edítalo y guarda para quitarlos.")}
        </div>
      )}
      {abierto && <Reproductor tut={tut} />}
    </div>
  );
}

/** El video, con un ancho máximo razonable. */
function Reproductor({ tut }: { tut: Tutorial }) {
  const { t } = usePrefs();
  const em = tutorialEmbed(tut.url);
  return (
    <div style={{ padding: "6px 8px 4px", maxWidth: 560 }}>
      {tut.description && <div className="hint" style={{ marginBottom: 6 }}>{tut.description}</div>}
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
  );
}
