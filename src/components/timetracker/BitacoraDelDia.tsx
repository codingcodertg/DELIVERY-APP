"use client";

import { useState } from "react";
import { getEntryDayLog, type BitacoraResult } from "@/app/timetracker/clock-in/actions/bitacora";
import type { DayPhoto } from "@/app/timetracker/clock-in/actions/photos";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { fmtTime } from "@/lib/timetracker/helpers";
import type { PhotoKind } from "@/lib/clockin/day-photos";

/**
 * La bitácora de un fichaje, plegada bajo su fila de Nómina (D-758): entrada, comida, visitas y salida, con sus horas y
 * sus fotos en pequeño; al tocar una foto se abre el visor del hub. Se carga al abrir, no antes: Nómina no se vuelve lenta
 * por los días que nadie despliega.
 */

type Linea = { at: string; texto: string; foto?: DayPhoto };

// Claves literales, una por tipo, para la prueba de claves de D-187.
function kindLabel(t: ReturnType<typeof useT>, k: PhotoKind): string {
  if (k === "in") return t("mgr.photos.kindIn");
  if (k === "out") return t("mgr.photos.kindOut");
  if (k === "left") return t("mgr.photos.kindLeft");
  if (k === "stop") return t("mgr.photos.kindStop");
  return t("mgr.photos.kindBack");
}

/** Las líneas del turno, en orden: cada foto es una línea; las salidas y paradas sin foto también. */
export function lineasDeLaBitacora(r: Extract<BitacoraResult, { ok: true }>, t: ReturnType<typeof useT>): Linea[] {
  const lineas: Linea[] = r.photos.map((f) => ({ at: f.at, texto: `${kindLabel(t, f.kind)}${f.note ? ` · ${f.note}` : ""}${f.siteName ? ` · ${f.siteName}` : ""}`, foto: f }));
  const conFoto = new Set(r.photos.map((f) => f.at));
  for (const s of r.salidas) {
    if (!conFoto.has(s.leftAt)) lineas.push({ at: s.leftAt, texto: `${t("mgr.pay.daylog.left")}${s.reason ? ` · ${s.reason}` : ""}${s.note ? ` · ${s.note}` : ""}` });
    if (s.returnedAt && !conFoto.has(s.returnedAt)) lineas.push({ at: s.returnedAt, texto: t("mgr.pay.daylog.back") });
  }
  for (const p of r.paradas) {
    if (!p.conFoto) lineas.push({ at: p.arrivedAt, texto: `${t("mgr.pay.daylog.visit")}${p.label ? ` · ${p.label}` : ""}${p.address ? ` · ${p.address}` : ""}` });
  }
  return lineas.sort((a, b) => a.at.localeCompare(b.at));
}

export function BitacoraDelDia({ entryId }: { entryId: string }) {
  const t = useT();
  const lang = getLang() === "es" ? "es" : "en";
  const [estado, setEstado] = useState<"cerrada" | "cargando" | "lista" | "error">("cerrada");
  const [datos, setDatos] = useState<Extract<BitacoraResult, { ok: true }> | null>(null);
  const [viendo, setViendo] = useState<number | null>(null);

  const abrir = async () => {
    if (datos || estado === "cargando") return;
    setEstado("cargando");
    const r = await getEntryDayLog(entryId);
    if (!r.ok) { setEstado("error"); return; }
    setDatos(r);
    setEstado("lista");
  };

  const lineas = datos ? lineasDeLaBitacora(datos, t) : [];
  const urls = datos ? datos.photos.map((f) => f.url) : [];
  const credits = datos ? Object.fromEntries(datos.photos.map((f) => [f.url, { name: f.who, role: kindLabel(t, f.kind) }])) : {};

  return (
    <details className="bitacora-del-dia" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void abrir(); }} data-bitacora={entryId}>
      <summary className="small muted" style={{ cursor: "pointer" }}>📒 {t("mgr.pay.daylog.title")}</summary>
      {estado === "cargando" && <div className="small muted">{t("mgr.pay.daylog.loading")}</div>}
      {estado === "error" && <div className="small muted">{t("mgr.pay.daylog.error")}</div>}
      {estado === "lista" && lineas.length === 0 && <div className="small muted">{t("mgr.pay.daylog.empty")}</div>}
      {estado === "lista" && lineas.length > 0 && (
        <ul className="bitacora-lineas">
          {lineas.map((l, i) => (
            <li key={`${l.at}-${i}`} className="bitacora-linea">
              {l.foto ? (
                <button type="button" className="bitacora-foto" onClick={() => setViendo(urls.indexOf(l.foto!.url))} aria-label={l.texto}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.foto.url} alt="" loading="lazy" />
                </button>
              ) : <span className="bitacora-sin-foto" aria-hidden="true">·</span>}
              <span className="small nowrap"><b>{fmtTime(Date.parse(l.at))}</b></span>
              <span className="small">{l.texto}</span>
            </li>
          ))}
        </ul>
      )}
      {viendo !== null && urls[viendo] && (
        <PhotoLightbox photos={urls} index={viendo} credits={credits} onIndex={setViendo} onClose={() => setViendo(null)} t={(en, es) => (lang === "es" ? es : en)} />
      )}
    </details>
  );
}
