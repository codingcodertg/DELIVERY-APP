"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { downloadCSV, shiftDateISO, todayISO, toCSV } from "@/lib/utils";
import { areaLabel } from "@/lib/encuestas/areas";
import { almacenDeLaBase, type AlmacenDeEncuestas } from "@/lib/encuestas/almacen";
import { almacenDemo } from "@/lib/encuestas/demo";
import {
  eleccionesDe, fechaHora, filtrarPorFechas, paraContactar, porArea, porcentajeNada, respuestasPorDia, tablaCsv, textosOther,
  type RespuestaEncuesta,
} from "@/lib/encuestas/resumen";

type Estado = { tipo: "cargando" } | { tipo: "sinTabla" } | { tipo: "error"; texto: string } | { tipo: "listo" };

/**
 * El enlace público de la encuesta (D-449: sitio aparte, `rtg2/rtg-encuesta` en Vercel) y su QR, a la vista en esta pestaña
 * (D-496). El dueño, 2026-10-07: «Have the survey link in the survey tab».
 */
export const ENLACE_DE_LA_ENCUESTA = "https://rtg-encuesta.vercel.app";
export const QR_DE_LA_ENCUESTA = "/encuesta-qr.png";

/** Los atajos del filtro de fechas, en días hacia atrás desde hoy (incluido). null = sin límite. */
const ATAJOS: { dias: number | null; en: string; es: string }[] = [
  { dias: 7, en: "7 days", es: "7 días" },
  { dias: 30, en: "30 days", es: "30 días" },
  { dias: 90, en: "90 days", es: "90 días" },
  { dias: null, en: "All", es: "Todo" },
];

/**
 * «Encuestas» (migración 155): los resultados de la encuesta de clientes del sitio público.
 *
 * Todo lo que calcula vive en `lib/encuestas/resumen` y está probado sin navegador; este componente lee (con la
 * sesión de quien mira, o el demo), filtra por fechas y pinta. Marcar contactado va por `mark_survey_contacted`.
 *
 * La lista de contacto **no** obedece al filtro de fechas: una petición pendiente de hace dos meses no puede
 * esconderse porque el filtro diga «30 días». Lo demás, sí.
 */
export function Encuestas({ demo }: { demo: boolean }) {
  const { t, lang } = usePrefs();
  const almacen: AlmacenDeEncuestas = useMemo(() => (demo ? almacenDemo() : almacenDeLaBase(createClient())), [demo]);

  const [filas, setFilas] = useState<RespuestaEncuesta[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [copiado, setCopiado] = useState(false);
  const [hasta, setHasta] = useState<string>(() => todayISO());
  const [desde, setDesde] = useState<string>(() => shiftDateISO(todayISO(), -29));
  const [marcando, setMarcando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await almacen.leer();
    if (r.ok) { setFilas(r.valor); setEstado({ tipo: "listo" }); return; }
    setEstado(r.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: r.error });
  }, [almacen]);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => filtrarPorFechas(filas, desde || null, hasta || null), [filas, desde, hasta]);
  const serie = useMemo(() => respuestasPorDia(visibles, desde || null, hasta || null), [visibles, desde, hasta]);
  const areas = useMemo(() => porArea(visibles), [visibles]);
  const nada = useMemo(() => porcentajeNada(visibles), [visibles]);
  const otros = useMemo(() => textosOther(visibles), [visibles]);
  const contactar = useMemo(() => paraContactar(filas), [filas]);
  const pendientes = contactar.filter((f) => !f.contacted).length;
  const maxSerie = Math.max(1, ...serie.map((s) => s.n));
  const maxArea = Math.max(1, ...areas.map((a) => a.veces));

  const atajo = (dias: number | null) => {
    const hoy = todayISO();
    setHasta(dias === null ? "" : hoy);
    setDesde(dias === null ? "" : shiftDateISO(hoy, -(dias - 1)));
  };

  const marcar = async (f: RespuestaEncuesta, valor: boolean) => {
    setMarcando(f.id);
    setAviso(null);
    const r = await almacen.marcarContactado(f.id, valor);
    setMarcando(null);
    if (!r.ok) {
      setAviso(`${t("Could not save", "No se pudo guardar")}: ${r.error}`);
      return;
    }
    // Lo que quedó lo dice la base (la hora es la suya); no se da por hecho.
    setFilas((prev) => prev.map((x) => (x.id === f.id ? { ...x, contacted: valor, contacted_at: r.valor } : x)));
  };

  const exportar = () => {
    const { cabeceras, filas: cuerpo } = tablaCsv(visibles);
    downloadCSV(`surveys_${desde || "start"}_${hasta || todayISO()}.csv`, toCSV(cabeceras, cuerpo));
  };

  return (
    <div className="enc-wrap">
      <div className="enc-cabecera">
        <div>
          <Link href="/home" className="btn btn-ghost btn-sm">◂ {t("Back to hub", "Volver al hub")}</Link>
          <h1 style={{ marginTop: 10 }}>📋 {t("Customer surveys", "Encuestas de clientes")}</h1>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Answers from the public survey site.", "Las respuestas del sitio público de la encuesta.")}
            {demo ? ` ${t("Demo data.", "Datos de demostración.")}` : ""}
          </p>
        </div>
      </div>

      <div className="card" data-enlace-encuesta style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <img src={QR_DE_LA_ENCUESTA} alt={t("Survey QR code", "Código QR de la encuesta")} width={96} height={96}
          style={{ borderRadius: 8, border: "1px solid var(--line)", background: "#fff", flex: "0 0 auto" }} />
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>🔗 {t("Survey link", "Enlace de la encuesta")}</div>
          <a href={ENLACE_DE_LA_ENCUESTA} target="_blank" rel="noopener noreferrer" style={{ wordBreak: "break-all", fontSize: 15 }}>{ENLACE_DE_LA_ENCUESTA}</a>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" data-copiar-enlace onClick={() => {
              void navigator.clipboard?.writeText(ENLACE_DE_LA_ENCUESTA).then(() => setCopiado(true), () => setCopiado(false));
            }}>{copiado ? `✓ ${t("Copied", "Copiado")}` : `📋 ${t("Copy link", "Copiar enlace")}`}</button>
            <a className="btn btn-ghost btn-sm" href={ENLACE_DE_LA_ENCUESTA} target="_blank" rel="noopener noreferrer">↗ {t("Open", "Abrir")}</a>
            <a className="btn btn-ghost btn-sm" href={QR_DE_LA_ENCUESTA} download="RTG-encuesta-QR.png">⬇ {t("Download QR", "Descargar QR")}</a>
          </div>
        </div>
      </div>

      {estado.tipo === "sinTabla" && (
        <div className="enc-aviso ambar" data-aviso-sin-tabla>
          {t(
            "The survey table is not in the database yet (migration 155 is not applied). Nothing to show.",
            "La tabla de encuestas aún no está en la base (falta aplicar la migración 155). No hay nada que enseñar.",
          )}
        </div>
      )}
      {estado.tipo === "error" && (
        <div className="enc-aviso rojo" data-aviso-error>
          {t("Could not read the responses", "No se pudieron leer las respuestas")}: {estado.texto}
        </div>
      )}
      {aviso && <div className="enc-aviso rojo">{aviso}</div>}

      {estado.tipo === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}

      {estado.tipo === "listo" && (
        <>
          <div className="card">
            <div className="enc-filtro">
              <div>
                <label htmlFor="enc-desde">{t("From", "Desde")}</label>
                <input id="enc-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} />
              </div>
              <div>
                <label htmlFor="enc-hasta">{t("To", "Hasta")}</label>
                <input id="enc-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} />
              </div>
              {ATAJOS.map((a) => (
                <button key={a.en} type="button" className="btn btn-ghost btn-sm" onClick={() => atajo(a.dias)}>
                  {t(a.en, a.es)}
                </button>
              ))}
            </div>
            <p className="hint">{t("Days are Texas time.", "Los días son hora de Texas.")}</p>
          </div>

          <div className="kpi-grid">
            <div className="kpi" data-kpi-total><b>{visibles.length}</b><span>{t("Responses", "Respuestas")}</span></div>
            <div className="kpi" data-kpi-nada>
              <b>{nada === null ? "—" : `${Math.round(nada)}%`}</b>
              <span>{t("“Nothing, everything was great”", "«Nada, todo estuvo bien»")}</span>
            </div>
            <div className="kpi" data-kpi-pendientes><b>{pendientes}</b><span>{t("To contact", "Por contactar")}</span></div>
          </div>

          <div className="card">
            <h2>📈 {t("Responses per day", "Respuestas por día")}</h2>
            {serie.length === 0 ? (
              <p className="hint">{t("No responses in this range.", "Sin respuestas en este rango.")}</p>
            ) : (
              <>
                <div className="enc-serie" data-serie>
                  {serie.map((s) => (
                    <div key={s.dia} className="enc-serie-col" title={`${s.dia}: ${s.n}`}>
                      <div className="enc-serie-barra" style={{ height: `${(s.n / maxSerie) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="enc-serie-ejes"><span>{serie[0].dia}</span><span>{t("max", "máx.")} {maxSerie}</span><span>{serie[serie.length - 1].dia}</span></div>
              </>
            )}
          </div>

          <div className="card">
            <h2>🧩 {t("By area", "Por área")}</h2>
            <div className="bar-list">
              {areas.map((a) => (
                <div className="bar-row" key={a.key} data-area={a.key}>
                  <span className="bar-label enc-area-label">{areaLabel(a.key, lang)}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${(a.veces / maxArea) * 100}%`, background: "var(--accent)" }} />
                  </span>
                  <span className="bar-num" title={t("Times selected", "Veces elegida")}>{a.veces}</span>
                  <span className="bar-num" style={{ flexBasis: 70 }} title={t("Average rating (1-5)", "Calificación media (1-5)")}>
                    {a.media === null ? "—" : `★ ${a.media.toFixed(1)}`}
                  </span>
                </div>
              ))}
            </div>
            <p className="hint">{t("Times selected, and the average rating from 1 (very poor) to 5 (excellent).", "Veces elegida, y la calificación media del 1 (muy malo) al 5 (excelente).")}</p>
          </div>

          <div className="card">
            <h2>✍️ {t("“Other” answers", "Respuestas de «Otro»")}</h2>
            {otros.length === 0 ? (
              <p className="hint">{t("None in this range.", "Ninguna en este rango.")}</p>
            ) : (
              <ul className="enc-lista" data-otros>
                {otros.map((o) => (
                  <li key={o.id}>
                    <b>{o.texto}</b>
                    <span className="hint"> · {fechaHora(o.created_at)}{o.calificacion !== null ? ` · ★ ${o.calificacion}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card">
            <h2>📞 {t("Asked to be contacted", "Piden que los contacten")}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              {t("All dates, pending first — the date filter does not hide anyone waiting for a call.", "Todas las fechas, primero las pendientes: el filtro de fechas no esconde a nadie que espera una llamada.")}
            </p>
            {contactar.length === 0 ? (
              <p className="hint">{t("Nobody has asked yet.", "Nadie lo ha pedido todavía.")}</p>
            ) : (
              <div className="tbl-scroll">
                <table className="orders" data-contactar>
                  <thead>
                    <tr>
                      <th>{t("Date", "Fecha")}</th><th>{t("Name", "Nombre")}</th><th>{t("Phone", "Teléfono")}</th><th>{t("Email", "Correo")}</th>
                      <th>{t("Selected and rating", "Eligió y calificó")}</th><th>{t("Other", "Otro")}</th><th>{t("Contacted", "Contactado")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contactar.map((f) => (
                      <tr key={f.id} className={f.contacted ? "enc-contactado" : undefined}>
                        <td>{fechaHora(f.created_at)}</td>
                        <td>{f.contact_name}</td>
                        <td>{f.contact_phone ?? "—"}</td>
                        <td>{f.contact_email ? <a href={`mailto:${f.contact_email}`}>{f.contact_email}</a> : "—"}</td>
                        <td style={{ whiteSpace: "normal" }}>{eleccionesDe(f, lang)}</td>
                        <td style={{ whiteSpace: "normal" }}>{f.other_text ?? ""}</td>
                        <td>
                          {f.contacted ? (
                            <>
                              <span>✓ {f.contacted_at ? fechaHora(f.contacted_at) : ""}</span>{" "}
                              <button type="button" className="btn btn-ghost btn-sm" disabled={marcando === f.id} onClick={() => void marcar(f, false)}>
                                {t("Undo", "Deshacer")}
                              </button>
                            </>
                          ) : (
                            <button type="button" className="btn btn-green btn-sm" data-marcar={f.id} disabled={marcando === f.id} onClick={() => void marcar(f, true)}>
                              {t("Mark contacted", "Marcar contactado")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="enc-cabecera" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>🗂️ {t("All responses", "Todas las respuestas")} ({visibles.length})</h2>
              <button type="button" className="btn btn-primary btn-sm" data-exportar disabled={visibles.length === 0} onClick={exportar}>
                ⬇ {t("Export CSV", "Exportar CSV")}
              </button>
            </div>
            {visibles.length === 0 ? (
              <p className="hint">{t("No responses in this range.", "Sin respuestas en este rango.")}</p>
            ) : (
              <div className="tbl-scroll">
                <table className="orders" data-todas>
                  <thead>
                    <tr>
                      <th>{t("Date", "Fecha")}</th><th>{t("Selected and rating", "Eligió y calificó")}</th><th>{t("Other", "Otro")}</th>
                      <th>{t("Contact", "Contacto")}</th><th>{t("Contacted", "Contactado")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((f) => (
                      <tr key={f.id}>
                        <td>{fechaHora(f.created_at)}</td>
                        <td style={{ whiteSpace: "normal" }}>{eleccionesDe(f, lang)}</td>
                        <td style={{ whiteSpace: "normal" }}>{f.other_text ?? ""}</td>
                        <td>{f.wants_contact ? [f.contact_name, f.contact_phone, f.contact_email].filter(Boolean).join(" · ") : t("No", "No")}</td>
                        <td>{f.wants_contact ? (f.contacted ? "✓" : t("Pending", "Pendiente")) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
