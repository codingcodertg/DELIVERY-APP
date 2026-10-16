"use client";

import { useRef, useState } from "react";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { srcDeFoto } from "@/lib/fotos-en-storage";

// ============================================================
// Photos of the material, taken by the driver.
//
// On a phone this opens the camera directly (capture="environment"); on a
// desktop it's a normal file picker. Images are downscaled and re-encoded to
// JPEG in the browser before being stored — a raw phone photo is several MB,
// which would blow past the localStorage quota in demo mode and bloat rows in
// Supabase. ~1280px wide at q0.7 is plenty to prove what was delivered.
//
// Desde la 178 (D-NEXT) el `data:` comprimido NO se guarda en la fila: quien usa esto pasa `subir`, que lo manda al cubo
// `delivery-photos` y devuelve la ruta; `onChange` recibe rutas. `urls` trae la URL firmada con la que se pinta cada ruta.
// ============================================================

const MAX_DIM = 1280;
const QUALITY = 0.7;

/** Downscale + compress an image file to a JPEG data: URL. */
export function compress(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function PhotoUpload({
  photos,
  onChange,
  disabled,
  max = 6,
  credits,
  urls,
  subir,
  t,
  galeria = false,
}: {
  photos: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  max?: number;
  /** Con qué `src` se enseña cada foto (178): la URL firmada de una ruta del cubo. Sin entrada, la foto misma (`data:`). */
  urls?: Record<string, string>;
  /**
   * Sube las fotos recién comprimidas (`data:`) al cubo y devuelve sus RUTAS (178, D-NEXT). Con esto, `onChange`
   * recibe rutas, nunca base64; si la subida falla, se avisa y NO se llama a `onChange`: la orden no se guarda a medias.
   * Sin `subir` (modo enseñanza, o las fotos de la cámara que viajan con la entrega) se queda el `data:`.
   */
  subir?: (fotos: string[]) => Promise<{ ok: true; rutas: string[] } | { ok: false; message: string }>;
  /** Who took each photo, keyed by URL. A caption goes under any photo that
   * has one — the point of a delivery photo is partly who stands behind it. */
  credits?: Record<string, { name: string; role: string } | undefined>;
  t: (en: string, es: string) => string;
  /**
   * Dos botones en vez de uno (D-523): «📷 Cámara», que en el teléfono abre la cámara directo (`capture`), y «🖼 Galería»,
   * que abre el selector de fotos sin `capture`, para una foto ya tomada. Sin esto, uno solo que abre la cámara.
   */
  galeria?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr("");
    try {
      const room = Math.max(0, max - photos.length);
      const picked = [...files].slice(0, room);
      const encoded: string[] = [];
      for (const f of picked) {
        if (!f.type.startsWith("image/")) continue;
        try { encoded.push(await compress(f)); } catch { /* skip unreadable file */ }
      }
      if (!encoded.length) { setErr(t("Couldn't read those files.", "No se pudieron leer esos archivos.")); return; }
      let nuevas = encoded;
      if (subir) {
        const r = await subir(encoded);
        if (!r.ok) {
          setErr(t(`Couldn't upload the photo: ${r.message}. Nothing was saved.`, `No se pudo subir la foto: ${r.message}. No se guardó nada.`));
          return;
        }
        nuevas = r.rutas;
      }
      onChange([...photos, ...nuevas]);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      if (galeriaRef.current) galeriaRef.current.value = "";
    }
  };

  const remove = (i: number) => onChange(photos.filter((_, x) => x !== i));
  const full = photos.length >= max;

  return (
    <div>
      <div className="photo-grid">
        {photos.map((src, i) => (
          <div className="photo-item" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* window.open does nothing inside the Android WebView, so the
                photo simply wasn't clickable on the one device it matters on. */}
            <img src={srcDeFoto(src, urls)} alt={`photo ${i + 1}`} onClick={() => setViewing(i)} />
            {!disabled && <button className="photo-del" onClick={() => remove(i)} title={t("Remove", "Quitar")}>✕</button>}
            {/* Photos taken before attribution existed have no caption rather
                than a guessed one. */}
            {credits?.[src] && (
              <span className="photo-by" title={`${credits[src]!.name} · ${credits[src]!.role}`}>
                {credits[src]!.name}
                <span className="photo-by-role">{credits[src]!.role}</span>
              </span>
            )}
          </div>
        ))}
        {!disabled && !full && (
          <button className="photo-add" data-foto-camara={galeria ? "" : undefined} onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "…" : <>📷<span>{galeria ? t("Camera", "Cámara") : t("Add photo", "Agregar foto")}</span></>}
          </button>
        )}
        {galeria && !disabled && !full && !busy && (
          <button className="photo-add" data-foto-galeria onClick={() => galeriaRef.current?.click()}>
            🖼<span>{t("Gallery", "Galería")}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => add(e.target.files)}
      />
      {galeria && (
        <input ref={galeriaRef} type="file" accept="image/*" multiple hidden data-entrada-galeria onChange={(e) => add(e.target.files)} />
      )}

      {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}
      {full && <div className="hint">{t(`Maximum ${max} photos.`, `Máximo ${max} fotos.`)}</div>}
      {photos.length === 0 && disabled && <div className="hint">{t("No photos.", "Sin fotos.")}</div>}

      {viewing !== null && photos[viewing] && (
        <PhotoLightbox
          photos={photos}
          index={viewing}
          credits={credits}
          urls={urls}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
          t={t}
        />
      )}
    </div>
  );
}
