"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageLabel } from "@/lib/constants";
import {
  MINIMO_DEL_MOTIVO, ajenasParaTomar, etiquetaDeLaOrden, motivoValido, pideMotivo, sePuedeBuscar, type OrdenParaTomar,
} from "@/lib/tomar-orden";

/**
 * Debajo del buscador de facturas del chofer (D-625, 2026-10-21; migración 188): las órdenes con ESA factura que no son
 * suyas, y «🚚 Recoger (excepción)» con un motivo. Tomada, es suya (para hoy y fuera de la ruta de otro) y se recoge por
 * el camino de siempre: la pantalla abre la orden (`alTomar`).
 *
 * D-735 (migración 213): las que NO tienen chofer van primero, en su propia tarjeta, con «➕ Agregar a mi ruta» y sin
 * motivo: no es una excepción, es cómo sale una orden que no era de nadie. Las de otro chofer siguen igual que antes.
 *
 * Solo pregunta con 4 caracteres o más, medio segundo después de dejar de teclear, y solo al chofer.
 */
export function TomarFacturaAjena({ texto, misIds, alTomar }: { texto: string; misIds: ReadonlySet<string>; alTomar: (id: string) => void }) {
  const { buscarFacturaParaRecoger, tomarOrdenParaRecoger } = useData();
  const { t, lang } = usePrefs();
  const [filas, setFilas] = useState<OrdenParaTomar[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [tomando, setTomando] = useState(false);
  const sePuede = sePuedeBuscar(texto);

  useEffect(() => {
    setEligiendo(null);
    setMotivo("");
    if (!sePuede) { setFilas([]); return; }
    let vivo = true;
    setBuscando(true);
    const id = setTimeout(async () => {
      const r = await buscarFacturaParaRecoger(texto);
      if (!vivo) return;
      setFilas(r ?? []);
      setBuscando(false);
    }, 500);
    return () => { vivo = false; clearTimeout(id); setBuscando(false); };
  }, [texto, sePuede, buscarFacturaParaRecoger]);

  if (!sePuede) return null;
  const ajenas = ajenasParaTomar(filas, misIds);
  if (buscando && ajenas.length === 0) return <div className="hint" data-buscando-ajenas>🔎 {t("Looking in all orders…", "Buscando en todas las órdenes…")}</div>;
  if (ajenas.length === 0) return null;

  const tomar = async (o: OrdenParaTomar) => {
    if ((pideMotivo(o) && !motivoValido(motivo)) || tomando) return;
    setTomando(true);
    const ok = await tomarOrdenParaRecoger(o.id, pideMotivo(o) ? motivo : "", lang === "en" ? "en" : "es");
    setTomando(false);
    if (ok) { setEligiendo(null); setMotivo(""); setFilas((l) => l.filter((x) => x.id !== o.id)); alTomar(o.id); }
  };
  const sinChofer = ajenas.filter((o) => !pideMotivo(o));
  const deOtro = ajenas.filter((o) => pideMotivo(o));

  return (
    <>
    {sinChofer.length > 0 && (
      <div className="card" data-ordenes-sin-chofer style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          🚚 {t("Orders with that invoice with no driver", "Órdenes con esa factura sin chofer")}
        </div>
        <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
          {t("Adding one puts it on your route for today and lets the office know.",
             "Al agregarla pasa a tu ruta de hoy y se avisa a la oficina.")}
        </div>
        {sinChofer.map((o) => (
          <div key={o.id} className="fila-ajena" data-orden-sin-chofer={o.id}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b>{etiquetaDeLaOrden(o)}</b>
              <span className="chip" style={{ cursor: "default" }}>{stageLabel(o.stage, lang)}</span>
              <span className="hint" style={{ margin: 0 }}>
                {[o.account, o.store].filter(Boolean).join(" · ")}
              </span>
            </div>
            <div className="hint" style={{ margin: "2px 0 6px" }}>
              {t("No driver yet", "Sin chofer todavía")}
              {o.delivery_address ? ` · ${o.delivery_address}` : ""}
            </div>
            <button className="btn btn-primary btn-sm" disabled={tomando} onClick={() => void tomar(o)} data-agregar-a-mi-ruta>
              {tomando ? t("Adding…", "Agregando…") : `➕ ${t("Add to my route", "Agregar a mi ruta")}`}
            </button>
          </div>
        ))}
      </div>
    )}
    {deOtro.length > 0 && (
    <div className="card" data-ordenes-ajenas style={{ borderColor: "var(--amber)", marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        ⚠️ {t("Orders with that invoice that belong to another driver", "Órdenes con esa factura que son de OTRO chofer")}
      </div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
        {t("Only as an exception: taking one moves it to you for today and lets the office know.",
           "Solo como excepción: al tomarla pasa a ti para hoy y se avisa a la oficina.")}
      </div>
      {deOtro.map((o) => (
        <div key={o.id} className="fila-ajena" data-orden-ajena={o.id}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b>{etiquetaDeLaOrden(o)}</b>
            <span className="chip" style={{ cursor: "default" }}>{stageLabel(o.stage, lang)}</span>
            <span className="hint" style={{ margin: 0 }}>
              {[o.account, o.store].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="hint" style={{ margin: "2px 0 6px" }}>
            {t(`Driver now: ${o.assigned_driver}`, `Chofer ahora: ${o.assigned_driver}`)}
            {o.delivery_address ? ` · ${o.delivery_address}` : ""}
          </div>
          {eligiendo === o.id ? (
            <div style={{ display: "grid", gap: 6 }}>
              <textarea
                autoFocus
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder={t("Why are you taking it? (e.g. the assigned driver didn't come)", "¿Por qué la tomas? (p. ej. el chofer asignado no vino)")}
                aria-label={t("Reason", "Motivo")}
                rows={2}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-amber" disabled={!motivoValido(motivo) || tomando} onClick={() => void tomar(o)} data-tomar-orden>
                  {tomando ? t("Taking…", "Tomando…") : `🚚 ${t("Take it and pick up", "Tomarla y recoger")}`}
                </button>
                <button className="btn btn-ghost" onClick={() => { setEligiendo(null); setMotivo(""); }} disabled={tomando}>
                  {t("Cancel", "Cancelar")}
                </button>
                {!motivoValido(motivo) && (
                  <span className="hint" style={{ margin: 0, alignSelf: "center" }}>
                    {t(`At least ${MINIMO_DEL_MOTIVO} letters`, `Mínimo ${MINIMO_DEL_MOTIVO} letras`)}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => { setEligiendo(o.id); setMotivo(""); }} data-elige-ajena>
              🚚 {t("Pick up (exception)", "Recoger (excepción)")}
            </button>
          )}
        </div>
      ))}
    </div>
    )}
    </>
  );
}
