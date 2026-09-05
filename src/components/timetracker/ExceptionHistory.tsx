"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getExceptionHistory } from "@/app/timetracker/clock-in/actions/exceptions";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { dateISO, fmtDayLong, fmtDT } from "@/lib/timetracker/helpers";
import { getLang, useT } from "@/lib/timetracker/i18n";

/**
 * El historial de excepciones de fichaje, dentro de Auditoría.
 *
 * Cuarta pantalla de fichaje que se muda a Time Tracker, y la última que quedaba con motivo
 * propio para existir aparte (D-115). Va aquí y no en Pendientes porque son dos preguntas
 * distintas: Pendientes es **qué falta por atender**, Auditoría es **qué pasó** — y una
 * excepción resuelta desaparece de la primera pero sigue siendo historia.
 *
 * De solo lectura, a propósito. El botón de resolver vive en Pendientes y en un solo sitio
 * (D-106): dos botones que hacen lo mismo en dos pantallas acaban en dos versiones de la
 * verdad sobre si algo está atendido. Lo que hay aquí es el enlace a esa cola.
 *
 * G-9 (D-202): textos por claves mgr.exc.*. Los MOTIVOS (r.reasons) son valores guardados y
 * se enseñan tal cual; los tipos de excepción son un enumerado fijo del código y se traducen.
 * fmtDayLong no se toca: el día largo sigue en inglés.
 */

type Exc = {
  id: string; nombre: string; type: string; reason: string | null; reasons: string[]; note: string | null;
  created_at: string; left_at: string | null; returned_at: string | null;
  resolved: boolean; photo: string | null; returnedPhoto: string | null;
};

// Claves literales, una por rama, para que la prueba de claves de D-187 las vea en el fuente.
function tipo(t: ReturnType<typeof useT>, type: string): string {
  if (type === "out_of_radius") return t("mgr.exc.outOfRadius");
  if (type === "leaving_while_clocked_in") return t("mgr.exc.leftClockedIn");
  if (type === "missed_punch") return t("mgr.exc.missedPunch");
  if (type === "other") return t("mgr.exc.other");
  return type;
}

export function ExceptionHistory() {
  const t = useT();
  const lang = getLang(); // useT() ya fuerza el re-render al cambiar el idioma
  const [rows, setRows] = useState<Exc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [filtroMotivo, setFiltroMotivo] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getExceptionHistory();
    if (!res.ok) { setErr(res.message); setRows([]); }
    else { setErr(null); setRows(res.rows); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const porPendiente = soloPendientes ? rows.filter((r) => !r.resolved) : rows;
  const shown = filtroMotivo ? porPendiente.filter((r) => r.reasons.includes(filtroMotivo)) : porPendiente;
  const pendientes = rows.filter((r) => !r.resolved).length;

  /**
   * Cuántas veces se ha dado cada motivo (D-163).
   *
   * Es la pregunta que la pantalla no contestaba: se podían leer las excepciones una a una,
   * pero no saber **qué está pasando**. Y el primer dato que enseña ya duele — 56 de 78
   * salidas fuera de radio decían "otro", que es lo que se marca cuando solo te dejan
   * elegir una cosa y saliste por dos.
   *
   * Se cuenta sobre TODAS las filas, no sobre las filtradas: un recuento que cambia al
   * pulsarlo no sirve para comparar. Y una excepción con dos motivos suma en los dos —
   * porque las dos cosas pasaron.
   */
  const conteo = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of porPendiente) for (const x of r.reasons) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [porPendiente]);

  // El visor recorre las fotos que se están viendo, en el mismo orden que la lista.
  const fotos = useMemo(
    () => shown.flatMap((r) => [r.photo, r.returnedPhoto].filter((u): u is string => !!u)),
    [shown],
  );
  const creditos = useMemo(() => {
    const m: Record<string, { name: string; role: string }> = {};
    for (const r of shown) {
      if (r.photo) m[r.photo] = { name: r.nombre, role: tipo(t, r.type) };
      if (r.returnedPhoto) m[r.returnedPhoto] = { name: r.nombre, role: t("mgr.exc.back") };
    }
    return m;
  }, [shown, lang]);

  const porDia = new Map<string, Exc[]>();
  shown.forEach((r) => {
    const d = dateISO(new Date(r.created_at));
    porDia.set(d, [...(porDia.get(d) ?? []), r]);
  });

  const hora = (iso: string) => fmtDT(new Date(iso).getTime(), { hour: "2-digit", minute: "2-digit" });

  const miniatura = (url: string | null, alt: string) =>
    url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={alt} loading="lazy" className="exc-thumb"
        onClick={() => setViewing(fotos.indexOf(url))} />
    ) : null;

  return (
    <div className="card">
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.exc.title")}</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button className={`btn-ghost btn-sm${soloPendientes ? " pbtn sel" : ""}`}
            onClick={() => setSoloPendientes((v) => !v)}>
            {soloPendientes ? t("mgr.exc.showingUnresolved") : t("mgr.exc.all")}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => void load()}>{t("mgr.exc.refresh")}</button>
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 4 }}>
        {loading ? t("mgr.exc.loading") : t("mgr.exc.counts", { shown: shown.length, open: pendientes })}
        {" · "}
        {/* Se resuelve en Pendientes, no aquí: una sola cola, un solo botón. */}
        <Link href="/timetracker/team-requests" style={{ color: "var(--tt-accent)" }}>
          {t("mgr.exc.resolveLink")}
        </Link>
      </p>

      {/* El resumen por motivo, y filtra al tocarlo. Va arriba porque es lo que se mira
          primero: cuál es el motivo que más se repite este mes. */}
      {conteo.length > 0 && (
        <div className="filters" style={{ marginTop: 8 }}>
          {conteo.map(([m, n]) => (
            <button
              key={m}
              className={"chip" + (filtroMotivo === m ? " on" : "")}
              onClick={() => setFiltroMotivo(filtroMotivo === m ? null : m)}
            >
              {m.replace(/_/g, " ")} <span className="cnt">{n}</span>
            </button>
          ))}
          {filtroMotivo && (
            <button className="btn-ghost btn-sm" onClick={() => setFiltroMotivo(null)}>{t("mgr.exc.clear")}</button>
          )}
        </div>
      )}

      {err && <div className="banner err">{err}</div>}

      {!loading && !err && shown.length === 0 && (
        <p className="small muted">
          {soloPendientes ? t("mgr.exc.nothingLeft") : t("mgr.exc.none")}
        </p>
      )}

      {[...porDia.entries()].map(([dia, delDia]) => (
        <details key={dia} open style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            {fmtDayLong(dia)} <span className="chip" style={{ marginLeft: 6 }}>{delDia.length}</span>
          </summary>
          <ul className="exc-list">
            {delDia.map((r) => (
              <li key={r.id} className="exc-row">
                <div className="exc-shots">
                  {miniatura(r.photo, `${r.nombre} · ${tipo(t, r.type)}`)}
                  {miniatura(r.returnedPhoto, `${r.nombre} · ${t("mgr.exc.backAlt")}`)}
                  {!r.photo && !r.returnedPhoto && <div className="exc-noshot">{t("mgr.exc.noPhoto")}</div>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div>
                    <strong>{r.nombre}</strong>
                    <span className="muted small"> · {tipo(t, r.type)}</span>
                    {r.resolved
                      ? <span className="pill on" style={{ marginLeft: 6 }}>{t("mgr.exc.reviewed")}</span>
                      : <span className="pill wait" style={{ marginLeft: 6 }}>{t("mgr.exc.open")}</span>}
                  </div>
                  <div className="small muted">
                    {/* TODOS los motivos, no solo el primero (D-163). Desde que se pueden
                        marcar varios, enseñar uno sería esconder justo lo que se acaba de
                        pedir: que se sepa que alguien salió por una entrega Y de paso pasó
                        por otra tienda. */}
                    {r.reasons.length
                      ? r.reasons.map((x) => (
                          <span key={x} className="pill" style={{ marginRight: 4 }}>{x.replace(/_/g, " ")}</span>
                        ))
                      : "—"}
                    {r.note ? ` · “${r.note}”` : ""}
                  </div>
                  <div className="small muted">
                    {hora(r.created_at)}
                    {/* "Sigue fuera" es el dato que más importa de un vistazo: alguien que
                        salió y no ha vuelto no es lo mismo que uno que ya volvió. */}
                    {r.left_at && r.returned_at ? t("mgr.exc.backAt", { time: hora(r.returned_at) }) : ""}
                    {r.left_at && !r.returned_at ? t("mgr.exc.stillOut") : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}

      {viewing !== null && fotos[viewing] && (
        <PhotoLightbox photos={fotos} index={viewing} credits={creditos}
          onIndex={setViewing} onClose={() => setViewing(null)} t={(en, es) => (lang === "es" ? es : en)} />
      )}
    </div>
  );
}
