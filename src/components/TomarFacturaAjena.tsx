"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageLabel } from "@/lib/constants";
import {
  MINIMO_DEL_MOTIVO, ajenasParaTomar, etiquetaDeLaOrden, motivoValido, sePuedeBuscar, type OrdenParaTomar,
} from "@/lib/tomar-orden";

/**
 * Debajo del buscador de facturas del chofer (D-625, 2026-10-21; migración 188): las órdenes con ESA factura que no son
 * suyas, y «🚚 Recoger (excepción)» con un motivo. Tomada, es suya (para hoy y fuera de la ruta de otro) y se recoge por
 * el camino de siempre: la pantalla abre la orden (`alTomar`).
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
    if (!motivoValido(motivo) || tomando) return;
    setTomando(true);
    const ok = await tomarOrdenParaRecoger(o.id, motivo, lang === "en" ? "en" : "es");
    setTomando(false);
    if (ok) { setEligiendo(null); setMotivo(""); setFilas((l) => l.filter((x) => x.id !== o.id)); alTomar(o.id); }
  };

  return (
    <div className="card" data-ordenes-ajenas style={{ borderColor: "var(--amber)", marginBottom: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>
        ⚠️ {t("Orders with that invoice that are NOT yours", "Órdenes con esa factura que NO son tuyas")}
      </div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>
        {t("Only as an exception: taking one moves it to you for today and lets the office know.",
           "Solo como excepción: al tomarla pasa a ti para hoy y se avisa a la oficina.")}
      </div>
      {ajenas.map((o) => (
        <div key={o.id} className="fila-ajena" data-orden-ajena={o.id}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b>{etiquetaDeLaOrden(o)}</b>
            <span className="chip" style={{ cursor: "default" }}>{stageLabel(o.stage, lang)}</span>
            <span className="hint" style={{ margin: 0 }}>
              {[o.account, o.store].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="hint" style={{ margin: "2px 0 6px" }}>
            {o.assigned_driver
              ? t(`Driver now: ${o.assigned_driver}`, `Chofer ahora: ${o.assigned_driver}`)
              : t("No driver yet", "Sin chofer todavía")}
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
  );
}
