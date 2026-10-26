"use client";

/**
 * «📎 Adjuntos» de una orden ya guardada (migración 204): la factura en PDF, una captura… Se adjuntan con el botón,
 * arrastrando a la zona, o PEGANDO (Ctrl+V / Cmd+V) en cualquier sitio mientras la orden está abierta. Un pegado de
 * texto en un campo sigue siendo del campo (`decisionAlPegar`). Sin la 204 aplicada, la sección se esconde con una nota.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  almacenDeAdjuntos, decisionAlPegar, esCampoDeTexto, ficherosDeLaTransferencia, problemaDeAdjunto, tamanoLegible,
  TIPOS_DE_ADJUNTO, type AdjuntoDeOrden,
} from "@/lib/adjuntos-de-orden";

type T = (en: string, es: string) => string;

export function AdjuntosDeLaOrden({ deliveryId, puedeEditar, t }: { deliveryId: string; puedeEditar: boolean; t: T }) {
  const almacen = useMemo(() => almacenDeAdjuntos(createClient()), []);
  const [lista, setLista] = useState<AdjuntoDeOrden[] | null>(null);
  const [sinTabla, setSinTabla] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(0);
  const [encima, setEncima] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    setLista(null); setAviso(null); setSinTabla(false);
    void almacen.lista(deliveryId).then((r) => {
      if (!vivo) return;
      if (r.ok) { setLista(r.valor); return; }
      setLista([]);
      if (r.sinTabla) setSinTabla(true);
      else setAviso(t("Could not load the attachments: ", "No se pudieron leer los adjuntos: ") + r.error);
    });
    return () => { vivo = false; };
  }, [almacen, deliveryId, t]);

  const sube = useCallback(async (ficheros: File[]) => {
    if (!puedeEditar || ficheros.length === 0) return;
    const problemas: string[] = [];
    const validos = ficheros.filter((f) => { const p = problemaDeAdjunto(f, t); if (p) problemas.push(p); return !p; });
    setAviso(problemas.length ? problemas.join(" ") : null);
    for (const f of validos) {
      setSubiendo((n) => n + 1);
      const r = await almacen.sube(deliveryId, f);
      setSubiendo((n) => n - 1);
      if (r.ok) setLista((l) => [r.valor, ...(l ?? [])]);
      else setAviso((a) => [a, t(`«${f.name}» not attached: `, `«${f.name}» no se adjuntó: `) + r.error].filter(Boolean).join(" "));
    }
  }, [almacen, deliveryId, puedeEditar, t]);

  // Pegar en cualquier sitio mientras la orden está abierta (el componente vive dentro del modal).
  useEffect(() => {
    if (!puedeEditar || sinTabla) return;
    const alPegar = (e: ClipboardEvent) => {
      const ficheros = ficherosDeLaTransferencia(e.clipboardData);
      const d = decisionAlPegar(ficheros.length, esCampoDeTexto(document.activeElement as HTMLElement | null));
      if (d.cancela) e.preventDefault();
      if (d.adjunta) void sube(ficheros);
    };
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [puedeEditar, sinTabla, sube]);

  const abre = async (a: AdjuntoDeOrden) => {
    const ventana = window.open("about:blank", "_blank");
    const r = await almacen.enlace(a);
    if (r.ok && ventana) ventana.location.href = r.valor;
    else { ventana?.close(); setAviso(t("Could not open it: ", "No se pudo abrir: ") + (r.ok ? "" : r.error)); }
  };
  const quita = async (a: AdjuntoDeOrden) => {
    if (!window.confirm(t(`Remove «${a.name}»?`, `¿Quitar «${a.name}»?`))) return;
    const r = await almacen.quita(a);
    if (!r.ok) { setAviso(t("Not removed: ", "No se quitó: ") + r.error); return; }
    setLista((l) => (l ?? []).filter((x) => x.id !== a.id));
  };

  return (
    <div data-adjuntos-de-la-orden={lista?.length ?? ""}>
      <div className="section-label">
        📎 {t("Attachments", "Adjuntos")}
        {!!lista?.length && <span className="count-tag" style={{ marginLeft: 8 }}>{lista.length}</span>}
      </div>
      {sinTabla ? (
        <div className="hint">{t("Attachments are not available yet (migration 204).", "Los adjuntos aún no están disponibles (migración 204).")}</div>
      ) : (
        <>
          {lista === null ? (
            <div className="hint">{t("Loading…", "Cargando…")}</div>
          ) : lista.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0" }}>
              {lista.map((a) => (
                <li key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "2px 0" }} data-adjunto={a.id}>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }} onClick={() => void abre(a)} title={a.name}>
                    {a.content_type?.startsWith("image/") ? "🖼" : "📄"} {a.name}
                  </button>
                  <span className="hint" style={{ flexShrink: 0, margin: 0 }}>{tamanoLegible(a.size)}</span>
                  {puedeEditar && (
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }} onClick={() => void quita(a)} aria-label={t(`Remove ${a.name}`, `Quitar ${a.name}`)}>✕</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {puedeEditar && (
            <div
              data-zona-de-adjuntos
              onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setEncima(true); } }}
              onDragLeave={() => setEncima(false)}
              onDrop={(e) => { e.preventDefault(); setEncima(false); void sube(ficherosDeLaTransferencia(e.dataTransfer)); }}
              style={{
                border: `2px dashed ${encima ? "var(--accent, #c2410c)" : "var(--border, #cbd5e1)"}`, borderRadius: 10,
                padding: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
              }}
            >
              <input ref={entrada} type="file" multiple hidden accept={TIPOS_DE_ADJUNTO.join(",")} onChange={(e) => { void sube(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              <button type="button" className="btn btn-sm" disabled={subiendo > 0} onClick={() => entrada.current?.click()}>
                {subiendo > 0 ? t("Uploading…", "Subiendo…") : `📎 ${t("Attach file", "Adjuntar archivo")}`}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {t("…or drop it here, or paste it (Ctrl+V / ⌘V). PDF, images, Office; up to 25 MB.", "…o arrástrelo aquí, o péguelo (Ctrl+V / ⌘V). PDF, imágenes, Office; hasta 25 MB.")}
              </span>
            </div>
          )}
        </>
      )}
      {aviso && <div className="hint" role="status" style={{ color: "var(--danger, #dc2626)" }}>{aviso}</div>}
    </div>
  );
}
