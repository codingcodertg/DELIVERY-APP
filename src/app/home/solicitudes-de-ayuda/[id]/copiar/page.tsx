"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { CUBO_DE_ADJUNTOS, type FicheroAdjunto } from "@/lib/help-attachments";
import type { SolicitudDeAyuda } from "@/lib/help-requests";
import { hiloCompleto, RUTA_SOLICITUDES_ADMIN, type MensajeDeAyuda } from "@/lib/help-thread";
import {
  documentosDelHilo, esIdDeSolicitud, htmlParaClaude, imagenesDelHilo, nombreDeDescarga, textoParaClaude,
  textoParaClaudeCode,
} from "@/lib/ayuda-para-claude";

/**
 * «Copiar para Claude» (D-844): una solicitud de ayuda lista para pegarla en Claude.
 *
 * Solo el admin llega aquí: la puerta es el `layout` de `/home/solicitudes-de-ayuda`, que envuelve también esta ruta,
 * y debajo está la 120 (RLS), que no deja leer la solicitud de otra persona a quien no es admin.
 *
 * **Las capturas no salen del cubo privado.** Se bajan con la sesión (`storage.download`, las mismas políticas que
 * firman los enlaces de cinco minutos del hilo) y viven como `blob:` en esta pestaña; nada se hace público.
 *
 * Lo que se decide sin navegador —el texto, el HTML, los nombres— está en `lib/ayuda-para-claude.ts`, con su prueba.
 * Aquí queda lo que no se puede medir en vitest: el portapapeles, el lienzo y la descarga.
 */

const COLUMNAS =
  "id, created_at, user_id, sender_name, sender_email, role_label, page, app_version, lang, message, files, email_to, email_ok, email_error, status, attended_by, attended_at";

type Captura = {
  adjunto: FicheroAdjunto;
  /** `blob:` del fichero tal cual, para verlo y descargarlo. */
  url: string | null;
  /** La misma imagen en PNG, que es lo que acepta el portapapeles en todos los navegadores. `null` si no se pudo. */
  png: Blob | null;
};

/** Pasa a PNG lo que no lo es (JPEG, WebP…), por un lienzo. HEIC en Chrome no se deja pintar: `null`. */
async function aPng(blob: Blob, nombre: string): Promise<Blob | null> {
  if (blob.type === "image/png") return blob;
  if (!blob.type && /\.png$/i.test(nombre)) return new Blob([blob], { type: "image/png" });
  try {
    const bmp = await createImageBitmap(blob);
    const lienzo = document.createElement("canvas");
    lienzo.width = bmp.width;
    lienzo.height = bmp.height;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    return await new Promise<Blob | null>((ok) => lienzo.toBlob((b) => ok(b), "image/png"));
  } catch {
    return null;
  }
}

const aDataUrl = (blob: Blob) =>
  new Promise<string | null>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(typeof r.result === "string" ? r.result : null);
    r.onerror = () => ok(null);
    r.readAsDataURL(blob);
  });

/** Descarga un `blob:` con su nombre, como si se hubiera pulsado un enlace. */
function descargaUrl(url: string, nombre: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const puedeEscribirPortapapeles = () =>
  typeof navigator !== "undefined" && !!navigator.clipboard?.write && typeof ClipboardItem !== "undefined";

type Estado =
  | { tipo: "nada" }
  | { tipo: "todo" } | { tipo: "texto" } | { tipo: "imagen" } | { tipo: "code" }
  | { tipo: "rechazado" } | { tipo: "fallo" } | { tipo: "documento" };

export default function CopiarParaClaudePage() {
  const { t } = usePrefs();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  const [solicitud, setSolicitud] = useState<SolicitudDeAyuda | null>(null);
  const [mensajes, setMensajes] = useState<MensajeDeAyuda[]>([]);
  /** Un código para lo que se sabe de antemano (así el efecto no depende del idioma) o el texto de la base. */
  const [error, setError] = useState<"id" | "nada" | { texto: string } | null>(null);
  const [capturas, setCapturas] = useState<Captura[] | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "nada" });
  const descargada = useRef(false);
  const urls = useRef<string[]>([]);

  // La solicitud y su hilo, con la sesión: la 120 decide qué se ve.
  useEffect(() => {
    if (!esIdDeSolicitud(id)) { setError("id"); return; }
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const [{ data: s, error: e1 }, { data: ms }] = await Promise.all([
        supabase.from("help_requests").select(COLUMNAS).eq("id", id).maybeSingle(),
        supabase.from("help_messages").select("id, request_id, author_id, author_name, body, files, created_at")
          .eq("request_id", id).order("created_at", { ascending: true }),
      ]);
      if (!vivo) return;
      if (e1) { setError({ texto: e1.message }); return; }
      if (!s) { setError("nada"); return; }
      setSolicitud(s as SolicitudDeAyuda);
      setMensajes((ms ?? []) as MensajeDeAyuda[]);
    })();
    return () => { vivo = false; };
  }, [id]);

  const hilo = useMemo(() => (solicitud ? hiloCompleto(solicitud, mensajes) : []), [solicitud, mensajes]);
  const imagenes = useMemo(() => imagenesDelHilo(hilo), [hilo]);
  const documentos = useMemo(() => documentosDelHilo(hilo), [hilo]);

  // Las capturas, bajadas con la sesión desde el cubo privado.
  useEffect(() => {
    if (!solicitud) return;
    let vivo = true;
    void (async () => {
      const almacen = createClient().storage.from(CUBO_DE_ADJUNTOS);
      const fuera: Captura[] = [];
      for (const adjunto of imagenes) {
        const { data: blob } = await almacen.download(adjunto.path).catch(() => ({ data: null }));
        if (!blob) { fuera.push({ adjunto, url: null, png: null }); continue; }
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        fuera.push({ adjunto, url, png: await aPng(blob, adjunto.nombre || adjunto.path) });
      }
      if (!vivo) return;
      setCapturas(fuera);
      const primera = fuera.find((c) => c.png)?.png;
      setDataUrl(primera ? await aDataUrl(primera) : null);
    })();
    return () => { vivo = false; };
  }, [solicitud, imagenes]);

  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u); }, []);

  const descargaTodas = useCallback((lista: Captura[]) => {
    // Escalonadas: dos descargas en el mismo instante, algún navegador se queda con una.
    lista.forEach((c, i) => {
      if (!c.url) return;
      const url = c.url;
      setTimeout(() => descargaUrl(url, nombreDeDescarga(id, i + 1, c.adjunto)), i * 400);
    });
  }, [id]);

  // Se descargan solas, una vez por pestaña: ni el doble efecto de React ni recargar la página las repiten.
  useEffect(() => {
    if (!capturas || descargada.current || !capturas.some((c) => c.url)) return;
    descargada.current = true;
    const clave = `ayuda-copiar-descargada:${id}`;
    try { if (sessionStorage.getItem(clave)) return; sessionStorage.setItem(clave, "1"); } catch { /* sin almacén: se descarga igual */ }
    descargaTodas(capturas);
  }, [capturas, id, descargaTodas]);

  const texto = useMemo(() => (solicitud
    ? textoParaClaude({
      solicitud,
      mensajes: hilo.slice(1),
      imagenes: imagenes.length,
      documentos: documentos.map((d) => d.nombre || d.path.split("/").pop() || d.path),
    })
    : ""), [solicitud, hilo, imagenes.length, documentos]);
  const primeraPng = capturas?.find((c) => c.png)?.png ?? null;

  // Todo de una vez: texto, HTML con la imagen dentro, y la imagen suelta. Sin `await` antes de `write`: Safari solo
  // deja escribir dentro del mismo gesto del clic.
  const copiaTodo = async () => {
    if (!puedeEscribirPortapapeles()) { setEstado({ tipo: "rechazado" }); return; }
    const partes: Record<string, Blob> = {
      "text/plain": new Blob([texto], { type: "text/plain" }),
      "text/html": new Blob([htmlParaClaude(texto, dataUrl)], { type: "text/html" }),
    };
    if (primeraPng) partes["image/png"] = primeraPng;
    try {
      await navigator.clipboard.write([new ClipboardItem(partes)]);
      setEstado({ tipo: "todo" });
    } catch {
      setEstado({ tipo: "rechazado" });
    }
  };

  const copiaTextoPlano = async (cual: string, tipo: "texto" | "code") => {
    try {
      await navigator.clipboard.writeText(cual);
      setEstado({ tipo });
    } catch {
      setEstado({ tipo: "fallo" });
    }
  };

  const copiaImagen = async (png: Blob | null) => {
    if (!png || !puedeEscribirPortapapeles()) { setEstado({ tipo: "fallo" }); return; }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setEstado({ tipo: "imagen" });
    } catch {
      setEstado({ tipo: "fallo" });
    }
  };

  /** Los documentos (PDF, Excel…) se abren como en el hilo: enlace firmado de cinco minutos. */
  const abreDocumento = async (path: string) => {
    const { data, error: e } = await createClient().storage.from(CUBO_DE_ADJUNTOS).createSignedUrl(path, 300);
    if (e || !data?.signedUrl) { setEstado({ tipo: "documento" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const aviso = (() => {
    switch (estado.tipo) {
      case "todo": return t("✅ Copied, paste it in Claude (Ctrl+V).", "✅ Copiado, pégalo en Claude (Ctrl+V).");
      case "texto": return t("✅ Text copied, paste it in Claude.", "✅ Texto copiado, pégalo en Claude.");
      case "imagen": return t("✅ Image copied, paste it in Claude.", "✅ Imagen copiada, pégala en Claude.");
      case "code": return t("✅ Copied, paste it in Claude Code.", "✅ Copiado, pégalo en Claude Code.");
      case "rechazado": return t(
        "This browser won't copy text and image together. Use “Copy text only” and then “Copy image only”.",
        "Este navegador no deja copiar texto e imagen juntos. Usa «Copiar solo texto» y luego «Copiar solo imagen».",
      );
      case "fallo": return t("Couldn't copy. Select the text below and copy it by hand.", "No se pudo copiar. Selecciona el texto de abajo y cópialo a mano.");
      case "documento": return t("Couldn't open the file.", "No se pudo abrir el archivo.");
      default: return null;
    }
  })();

  const volver = <Link href={RUTA_SOLICITUDES_ADMIN} className="btn btn-ghost btn-sm">{t("Back to help requests", "Volver a las solicitudes")}</Link>;

  if (error) {
    return (
      <>
        <div className="page-head"><h2>📋 {t("Copy for Claude", "Copiar para Claude")}</h2>{volver}</div>
        <div className="card" style={{ borderColor: "var(--red)" }}><b style={{ color: "var(--red)" }}>{
          error === "id" ? t("That isn't a help request link.", "Ese enlace no es de una solicitud de ayuda.")
            : error === "nada" ? t("That help request doesn't exist, or you can't see it.", "Esa solicitud no existe, o no la puedes ver.")
              : error.texto
        }</b></div>
      </>
    );
  }
  if (!solicitud) {
    return (
      <>
        <div className="page-head"><h2>📋 {t("Copy for Claude", "Copiar para Claude")}</h2>{volver}</div>
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      </>
    );
  }

  const cargando = imagenes.length > 0 && capturas === null;

  return (
    <>
      <div className="page-head">
        <h2>📋 {t("Copy for Claude", "Copiar para Claude")}</h2>
        {volver}
      </div>

      <div className="card" data-copiar-para-claude>
        <button type="button" className="btn btn-primary copia-claude-principal" disabled={cargando} onClick={copiaTodo} data-copia-todo>
          📋 {imagenes.length > 0 ? t("Copy text + image", "Copiar texto + imagen") : t("Copy text", "Copiar texto")}
        </button>
        {cargando && <p className="hint">{t("Loading the screenshot…", "Cargando la captura…")}</p>}
        {aviso && <p className="copia-claude-aviso" role="status">{aviso}</p>}

        <div className="copia-claude-botones">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copiaTextoPlano(texto, "texto")} data-copia-texto>
            {t("Copy text only", "Copiar solo texto")}
          </button>
          {imagenes.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!primeraPng} onClick={() => copiaImagen(primeraPng)} data-copia-imagen>
              {t("Copy image only", "Copiar solo imagen")}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copiaTextoPlano(textoParaClaudeCode(solicitud.id, imagenes.length), "code")} data-copia-code>
            ⌨️ {t("Copy for Claude Code", "Copiar para Claude Code")}
          </button>
        </div>
        <p className="hint">
          {t(
            "If your browser (Safari, Firefox) won't copy both at once, there's more than one image, or Claude keeps only the text or only the image: use “Copy text only”, paste, then “Copy image only” and paste again.",
            "Si el navegador (Safari, Firefox) no deja copiar las dos cosas a la vez, hay más de una imagen, o Claude se queda solo con el texto o solo con la imagen: usa «Copiar solo texto», pega, y luego «Copiar solo imagen» y pega otra vez.",
          )}
        </p>
      </div>

      {imagenes.length > 0 && (
        <div className="card">
          <div className="copia-claude-cabecera">
            <b>🖼️ {t("Screenshots", "Capturas")} ({imagenes.length})</b>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!capturas?.some((c) => c.url)} onClick={() => capturas && descargaTodas(capturas)} data-descarga-otra-vez>
              ⬇️ {t("Download again", "Descargar otra vez")}
            </button>
          </div>
          <div className="copia-claude-capturas">
            {(capturas ?? []).map((c, i) => (
              <figure key={c.adjunto.path} className="copia-claude-captura">
                {c.url
                  ? (
                    // eslint-disable-next-line @next/next/no-img-element -- un `blob:` de esta pestaña, no una imagen del sitio
                    <img src={c.url} alt={c.adjunto.nombre || `captura ${i + 1}`} />
                  )
                  : <span className="hint">{t("Couldn't load it.", "No se pudo cargar.")}</span>}
                <figcaption>
                  <span className="hint">{nombreDeDescarga(solicitud.id, i + 1, c.adjunto)}</span>
                  {imagenes.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!c.png} onClick={() => copiaImagen(c.png)}>
                      {t("Copy", "Copiar")}
                    </button>
                  )}
                  {c.url && !c.png && <span className="hint">{t("This format can't be copied here; it was downloaded.", "Este formato no se puede copiar aquí; ya se descargó.")}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      {documentos.length > 0 && (
        <div className="card">
          <b>📎 {t("Other attachments", "Otros adjuntos")}</b>
          <div className="copia-claude-botones">
            {documentos.map((d) => (
              <button key={d.path} type="button" className="btn btn-ghost btn-sm" onClick={() => abreDocumento(d.path)}>
                {d.nombre || d.path.split("/").pop()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <b>{t("What gets copied", "Lo que se copia")}</b>
        <textarea className="copia-claude-texto" readOnly value={texto} rows={14} onFocus={(e) => e.currentTarget.select()} />
      </div>
    </>
  );
}
