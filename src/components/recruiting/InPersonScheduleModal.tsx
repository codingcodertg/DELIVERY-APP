"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import {
  contactoDeLaCita, contactoDeLaConfirmacion, etapaTrasAgendar, lugaresParaAgendar,
  prepararConfirmacionPresencial, validarFechaPresencial,
} from "@/lib/recruiting/agendar-presencial";
import { fmtDateTime } from "@/lib/recruiting/utils";

/**
 * «📅 Agendar entrevista presencial» (D-NEXT). Fecha y hora (futura), lugar (sede o texto) y nota.
 * Al guardar: `inperson_date`, la etapa que toque (librería), el contacto «In person / Scheduled», y
 * después OFRECE mandar el texto de confirmación por el mismo camino que D-581 —enlace a RingCentral,
 * contacto SMS marcado— sin obligar. Permisos: los de la entrevista; ninguno extra.
 */
export function InPersonScheduleModal({ id, close }: { id: string; close: () => void }) {
  const { candidates, stages, updateCandidate, addContact, notify, me } = useData();
  const { t, lang } = usePrefs();
  const c = candidates.find((x) => x.id === id);
  const existing = c?.inperson_date ?? null;
  const [dt, setDt] = useState(existing ? existing.slice(0, 16) : "");
  const lugares = lugaresParaAgendar(c?.location ?? "");
  const [lugar, setLugar] = useState(c?.location && lugares.includes(c.location) ? c.location : lugares[0] ?? "");
  const [otro, setOtro] = useState(false);
  const [lugarLibre, setLugarLibre] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Tras guardar: la cita hecha, a la espera de «mandar confirmación» o «listo». */
  const [agendada, setAgendada] = useState<{ iso: string; lugar: string } | null>(null);
  const [confirmacionEnviada, setConfirmacionEnviada] = useState(false);
  if (!c) return null;

  const lugarElegido = (otro ? lugarLibre : lugar).trim();

  const save = async () => {
    const v = validarFechaPresencial(dt);
    if (!v.ok) {
      setError(
        v.motivo === "sin-fecha" ? t("Pick a date and time", "Elige fecha y hora")
        : v.motivo === "en-el-pasado" ? t("The date must be in the future", "La fecha tiene que ser futura")
        : t("Invalid date", "Fecha no válida"),
      );
      return;
    }
    setError(null);
    await updateCandidate(c.id, { inperson_date: v.iso, status: etapaTrasAgendar(stages, c.status) });
    await addContact(c.id, contactoDeLaCita(v.iso, lugarElegido, nota));
    notify(t("In-person interview scheduled ✓", "Entrevista presencial programada ✓"));
    setAgendada({ iso: v.iso, lugar: lugarElegido });
  };

  const mandarConfirmacion = async () => {
    if (!agendada) return;
    const r = prepararConfirmacionPresencial(c, agendada, me?.full_name ?? "", lang);
    if (!r.ok) { setError(t("No phone number", "Sin número de teléfono")); return; }
    window.location.href = r.enlace;
    await addContact(c.id, contactoDeLaConfirmacion(r.texto));
    setConfirmacionEnviada(true);
  };

  const quitar = async () => {
    await updateCandidate(c.id, { inperson_date: null });
    close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-agendar-presencial>
        <h3>📅 {t("Schedule in-person interview", "Agendar entrevista presencial")} — {c.name}</h3>

        {!agendada ? (
          <>
            <label>{t("Interview date and time", "Fecha y hora de la entrevista")}</label>
            <input type="datetime-local" value={dt} onChange={(e) => setDt(e.target.value)} />

            <label style={{ marginTop: 10 }}>{t("Place", "Lugar")}</label>
            <select value={otro ? "__otro__" : lugar} onChange={(e) => { if (e.target.value === "__otro__") setOtro(true); else { setOtro(false); setLugar(e.target.value); } }}>
              {lugares.map((l) => <option key={l} value={l}>{l}</option>)}
              <option value="__otro__">{t("Other…", "Otro…")}</option>
            </select>
            {otro && (
              <input placeholder={t("Address or place", "Dirección o lugar")} value={lugarLibre} onChange={(e) => setLugarLibre(e.target.value)} style={{ marginTop: 6 }} />
            )}

            <label style={{ marginTop: 10 }}>{t("Note (optional)", "Nota (opcional)")}</label>
            <input placeholder={t("e.g. bring ID", "p. ej. traer identificación")} value={nota} onChange={(e) => setNota(e.target.value)} />

            {error && <div style={{ color: "var(--red, #c0392b)", fontSize: 12, marginTop: 8 }}>{error}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={save}>{t("Save", "Guardar")}</button>
              {existing && <button className="btn btn-danger" onClick={quitar}>{t("Remove date", "Quitar fecha")}</button>}
              <button className="btn btn-ghost" onClick={close}>{t("Cancel", "Cancelar")}</button>
            </div>
          </>
        ) : (
          <>
            <div className="sent-tag" style={{ marginTop: 6 }}>
              ✓ {t("Scheduled", "Agendada")}: {fmtDateTime(agendada.iso)}{agendada.lugar ? ` · ${agendada.lugar}` : ""}
            </div>
            <p style={{ color: "var(--gray)", fontSize: 13, marginTop: 10 }}>
              {t("Send the candidate a confirmation text? It opens in RingCentral with the date, time and place filled in; nothing is sent until you press send there.",
                 "¿Mandar al candidato un texto de confirmación? Se abre en RingCentral con fecha, hora y lugar puestos; no sale nada hasta que lo envíes allí.")}
            </p>
            {error && <div style={{ color: "var(--red, #c0392b)", fontSize: 12, marginTop: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={mandarConfirmacion} disabled={confirmacionEnviada}>
                {confirmacionEnviada ? t("SMS sent ✓", "SMS enviado ✓") : "📱 " + t("Send confirmation text", "Mandar texto de confirmación")}
              </button>
              <button className="btn btn-ghost" onClick={close}>{t("Done", "Listo")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
