"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
// G-10 (D-204): texto de pantalla por pares inline (usePrefs).

// Gallery built from whatever images exist today (image_urls[] + product_images).
// Convention: the first image is the "pieces" shot (default); hovering the main
// image swaps to the next one (the room scene); clicking enlarges. folder_url, when
// present, links out to the source image folder.
export function ProductGallery({
  images,
  folderUrl,
  alt,
}: {
  images: string[];
  folderUrl: string | null;
  alt: string;
}) {
  const { t } = usePrefs();
  const [active, setActive] = useState(0); // selected thumbnail
  const [hovering, setHovering] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  if (images.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg bg-slate-50 text-sm text-slate-400">
        {t("No images yet", "Aún sin imágenes")}
        {folderUrl && (
          <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-clay-600 hover:underline">
            {t("Open image folder ↗", "Abrir carpeta de imágenes ↗")}
          </a>
        )}
      </div>
    );
  }

  // Default shows `active`; while hovering the main image, swap to the next ("room scene").
  const room = images[(active + 1) % images.length];
  const main = hovering && images.length > 1 ? room : images[active];

  return (
    <div>
      {folderUrl && (
        <div className="mb-2 text-right">
          <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-clay-600 hover:underline">
            {t("Image folder ↗", "Carpeta de imágenes ↗")}
          </a>
        </div>
      )}
      <button
        type="button"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => setZoom(main)}
        className="block w-full"
        title={images.length > 1 ? t("Hover for room scene · click to enlarge", "Pasa el ratón para la escena · clic para ampliar") : t("Click to enlarge", "Clic para ampliar")}
      >
        <img src={main} alt={alt} loading="lazy" className="mx-auto max-h-72 rounded-lg object-contain" />
      </button>

      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {images.map((src, i) => (
            <button
              key={src + i}
              type="button"
              onClick={() => setActive(i)}
              className={`h-12 w-12 overflow-hidden rounded-md ring-1 ${i === active ? "ring-2 ring-clay-500" : "ring-slate-200 hover:ring-clay-300"}`}
            >
              <img src={src} alt={`${alt} ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
        >
          <img src={zoom} alt={alt} className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
          <button type="button" onClick={() => setZoom(null)} aria-label={t("Close", "Cerrar")} className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-slate-700">
            {t("Close ✕", "Cerrar ✕")}
          </button>
        </div>
      )}
    </div>
  );
}
