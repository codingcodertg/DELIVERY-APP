"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getExceptionHistory } from "@/app/timetracker/clock-in/actions/exceptions";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { dateISO, fmtDayLong, fmtDT } from "@/lib/timetracker/helpers";

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
 */

type Exc = {
  id: string; nombre: string; type: string; reason: string | null; note: string | null;
  created_at: string; left_at: string | null; returned_at: string | null;
  resolved: boolean; photo: string | null; returnedPhoto: string | null;
};

const TIPO: Record<string, string> = {
  out_of_radius: "Off site",
  leaving_while_clocked_in: "Left while clocked in",
  missed_punch: "Missed punch",
  other: "Other",
};

export function ExceptionHistory() {
  const [rows, setRows] = useState<Exc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [soloPendientes, setSoloPendientes] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getExceptionHistory();
    if (!res.ok) { setErr(res.message); setRows([]); }
    else { setErr(null); setRows(res.rows); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = soloPendientes ? rows.filter((r) => !r.resolved) : rows;
  const pendientes = rows.filter((r) => !r.resolved).length;

  // El visor recorre las fotos que se están viendo, en el mismo orden que la lista.
  const fotos = useMemo(
    () => shown.flatMap((r) => [r.photo, r.returnedPhoto].filter((u): u is string => !!u)),
    [shown],
  );
  const creditos = useMemo(() => {
    const m: Record<string, { name: string; role: string }> = {};
    for (const r of shown) {
      if (r.photo) m[r.photo] = { name: r.nombre, role: TIPO[r.type] ?? r.type };
      if (r.returnedPhoto) m[r.returnedPhoto] = { name: r.nombre, role: "Back" };
    }
    return m;
  }, [shown]);

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
        <h2 style={{ margin: 0 }}>⚠️ Exceptions</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button className={`btn-ghost btn-sm${soloPendientes ? " pbtn sel" : ""}`}
            onClick={() => setSoloPendientes((v) => !v)}>
            {soloPendientes ? "Showing unresolved" : "All"}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => void load()}>Refresh</button>
        </div>
      </div>

      <p className="small muted" style={{ marginTop: 4 }}>
        {loading ? "loading…" : `${shown.length} shown · ${pendientes} still unresolved`}
        {" · "}
        {/* Se resuelve en Pendientes, no aquí: una sola cola, un solo botón. */}
        <Link href="/timetracker/team-requests" style={{ color: "var(--tt-accent)" }}>
          resolve them in Pending
        </Link>
      </p>

      {err && <div className="banner err">{err}</div>}

      {!loading && !err && shown.length === 0 && (
        <p className="small muted">
          {soloPendientes ? "Nothing left to review." : "No exceptions on record."}
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
                  {miniatura(r.photo, `${r.nombre} · ${TIPO[r.type] ?? r.type}`)}
                  {miniatura(r.returnedPhoto, `${r.nombre} · back`)}
                  {!r.photo && !r.returnedPhoto && <div className="exc-noshot">no photo</div>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div>
                    <strong>{r.nombre}</strong>
                    <span className="muted small"> · {TIPO[r.type] ?? r.type}</span>
                    {r.resolved
                      ? <span className="pill on" style={{ marginLeft: 6 }}>reviewed</span>
                      : <span className="pill wait" style={{ marginLeft: 6 }}>open</span>}
                  </div>
                  <div className="small muted">
                    {r.reason ? r.reason.replace(/_/g, " ") : "—"}
                    {r.note ? ` · “${r.note}”` : ""}
                  </div>
                  <div className="small muted">
                    {hora(r.created_at)}
                    {/* "Sigue fuera" es el dato que más importa de un vistazo: alguien que
                        salió y no ha vuelto no es lo mismo que uno que ya volvió. */}
                    {r.left_at && r.returned_at ? ` · back at ${hora(r.returned_at)}` : ""}
                    {r.left_at && !r.returned_at ? " · still out" : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}

      {viewing !== null && fotos[viewing] && (
        <PhotoLightbox photos={fotos} index={viewing} credits={creditos}
          onIndex={setViewing} onClose={() => setViewing(null)} t={(en) => en} />
      )}
    </div>
  );
}
