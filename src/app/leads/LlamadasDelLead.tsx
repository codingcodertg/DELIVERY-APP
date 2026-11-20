import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import type { AlmacenDeLeads } from "@/lib/leads/almacen";
import { telefonosDeLead, type LadoDelTelefono, type LlamadaDeLead } from "@/lib/leads/llamadas-rc";
import { fecha, type Lead } from "@/lib/leads/reglas";
import { telefonoBonito } from "@/lib/leads/telefonos";
import { duracionDeLlamada } from "@/lib/ringcentral-choferes/choferes";
import { ReproductorDeGrabacion } from "@/components/ringcentral/ReproductorDeGrabacion";

/**
 * Las llamadas de RingCentral a los teléfonos de este lead (337), dentro de su tarjeta: quién llamó o a quién, la fecha,
 * la duración y, si la hay, la grabación. La grabación se pide firmada al pulsar «Escuchar» y se toca con el mismo
 * reproductor de los candidatos (velocidad 1×, 1.5×, 2×). Sin llamadas, lo dice.
 */
export function LlamadasDelLead({ lead, lista, almacen }: { lead: Lead; lista: LlamadaDeLead[] | null; almacen: AlmacenDeLeads }) {
  const { t } = usePrefs();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Qué teléfono del lead es el de cada llamada: el del contratista o el del propietario (los de mano cuentan).
  const ladoDe = (clave: string): LadoDelTelefono | null => telefonosDeLead(lead).find((x) => x.clave === clave)?.lado ?? null;
  const etiquetaLado = (l: LadoDelTelefono | null) =>
    l === "contratista" ? t("contractor", "contratista") : l === "propietario" ? t("owner", "propietario") : "";

  const escuchar = async (llamada: LlamadaDeLead) => {
    setError(null);
    const r = await almacen.grabacionDeLlamada(lead.id, llamada.id);
    if (!r.ok) { setError(t("Could not load the recording.", "No se pudo cargar la grabación.")); return; }
    setUrls((prev) => ({ ...prev, [llamada.id]: r.valor }));
  };

  if (lista === null) return <ul className="ld-historial" data-llamadas-lista><li className="hint">{t("Loading…", "Cargando…")}</li></ul>;

  return (
    <ul className="ld-historial ld-llamadas" data-llamadas-lista>
      {lista.length === 0 && (
        <li className="hint">{t("No RingCentral calls to this lead's phones yet.", "Aún no hay llamadas de RingCentral a los teléfonos de este lead.")}</li>
      )}
      {lista.map((c) => {
        const lado = etiquetaLado(ladoDe(c.phone_key));
        return (
          <li key={c.id} className="ld-llamada" data-llamada={c.id}>
            <span aria-hidden="true">📞</span>{" "}
            <b>{c.direction === "in" ? t("Incoming", "Entrante") : t("Outgoing", "Saliente")}</b>
            {" · "}
            {c.rep_name ?? t("Unknown rep", "Vendedor sin nombre")}
            {c.rep_extension ? ` (ext. ${c.rep_extension})` : ""}
            {" · "}{fecha(c.started_at)}
            {c.duration_s != null && <> · {duracionDeLlamada(c.duration_s)}</>}
            {c.result && c.result !== "Accepted" && <> · <span className="hint">{c.result}</span></>}
            <div className="ld-llamada-tel hint">
              {telefonoBonito(c.phone_key)}{lado ? ` · ${lado}` : ""}
            </div>
            {c.has_recording && !urls[c.id] && (
              <button type="button" className="btn btn-ghost btn-sm" data-escuchar-llamada onClick={() => void escuchar(c)}>
                ▶ {t("Play", "Escuchar")}
              </button>
            )}
            {c.recording_pending && !c.has_recording && <span className="hint"> {t("Recording pending", "Grabación pendiente")}</span>}
            {urls[c.id] && <ReproductorDeGrabacion url={urls[c.id]} />}
          </li>
        );
      })}
      {error && <li className="hint ld-telefono-error" role="alert">{error}</li>}
    </ul>
  );
}
