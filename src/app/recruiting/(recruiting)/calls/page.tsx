"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { useUI } from "@/components/recruiting/ModalHost";
import { usePrefs } from "@/lib/prefs";
import { CALL_AGAIN_TAG, stageOf } from "@/lib/recruiting/constants";
import { fmtDateTime, rcCall, rcSms } from "@/lib/recruiting/utils";
import {
  contactoDeLaAccion,
  etiquetasTrasLaAccion,
  listaDeSeguimiento,
  type AccionDeSeguimiento,
  type ItemDeSeguimiento,
  type MotivoFallido,
} from "@/lib/recruiting/seguimiento-de-llamadas";

/** «📞 Llamadas pendientes» (D-629, 2026-10-21): los candidatos que dieron buzón de voz / sin respuesta / volver a
 * llamar, y las llamadas agendadas que aún no tienen desenlace. Se quedan aquí hasta que se pulsa «Ya le llamé»,
 * «Descartar» o se guarda la entrevista. Qué entra y qué saca lo decide `seguimiento-de-llamadas.ts`; esta página solo
 * pinta y escribe el contacto que la librería dice. Mismo armazón que «Hoy» (pastillas + tarjetas + mini-row). */
export default function CallsPage() {
  const { candidates, contacts, stages, ready, addContact, updateCandidate, notify } = useData();
  const ui = useUI();
  const { t, lang } = usePrefs();
  const [ocupado, setOcupado] = useState<string | null>(null);

  // «atrasada» cambia mientras la página sigue abierta
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { agendadas, fallidas } = listaDeSeguimiento(candidates, contacts, stages, now);
  const atrasadas = agendadas.filter((a) => a.atrasada).length;

  const motivo = (m: MotivoFallido) =>
    m === "buzon" ? "📞 " + t("Voicemail", "Buzón de voz")
      : m === "sin-respuesta" ? "📵 " + t("No answer", "Sin respuesta")
        : "🔁 " + t("Call back later", "Volver a llamar");

  const hacer = async (it: ItemDeSeguimiento, accion: AccionDeSeguimiento) => {
    if (ocupado) return;
    setOcupado(it.c.id);
    try {
      if (!(await addContact(it.c.id, contactoDeLaAccion(accion, it, lang)))) return;
      const tags = etiquetasTrasLaAccion(accion, it.c.tags ?? [], CALL_AGAIN_TAG);
      if (tags) await updateCandidate(it.c.id, { tags });
      notify(
        accion === "ya-llamado" ? t("Marked as called ✓", "Marcado como llamado ✓")
          : accion === "buzon" ? t("Voicemail logged — stays on the list", "Buzón registrado — sigue en la lista")
            : accion === "seguir" ? t("Kept on the list", "Sigue en la lista")
              : t("Removed from pending calls (the candidate is not discarded)", "Quitado de llamadas pendientes (el candidato no se descarta)"),
      );
    } finally {
      setOcupado(null);
    }
  };

  const nameBtn = (it: ItemDeSeguimiento) => (
    <button
      onClick={() => ui.openProfile(it.c.id)}
      title={t("Open profile", "Abrir perfil")}
      style={{ background: "none", border: "none", padding: 0, font: "inherit", fontWeight: 700, color: "inherit", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
    >
      {it.c.name}
    </button>
  );

  const contacto = (it: ItemDeSeguimiento) => (
    <>
      <a className="link-tel" href={rcCall(it.c.phone)} style={{ marginLeft: 10 }} onClick={() => addContact(it.c.id, { type: "Call", result: "", note: "" })}>📞 {it.c.phone}</a>
      <a className="link-tel" href={rcSms(it.c.phone)} style={{ marginLeft: 10 }} onClick={() => addContact(it.c.id, { type: "SMS", result: "sent", note: "" })}>💬 {t("Text", "Texto")}</a>
    </>
  );

  const botones = (it: ItemDeSeguimiento) => {
    const off = ocupado === it.c.id;
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn btn-primary btn-sm" disabled={off} onClick={() => ui.openInterview(it.c.id)}>🎤 {t("Interview", "Entrevista")}</button>
        <button className="btn btn-ghost btn-sm" disabled={off} onClick={() => hacer(it, "ya-llamado")}>✅ {t("Called", "Ya le llamé")}</button>
        <button className="btn btn-ghost btn-sm" disabled={off} onClick={() => hacer(it, "buzon")}>📞 {t("Voicemail", "Buzón de voz")}</button>
        {it.tipo === "fallida" && (
          <button className="btn btn-ghost btn-sm" disabled={off} onClick={() => hacer(it, "seguir")}>🔁 {t("Keep following up", "Seguir llamando")}</button>
        )}
        <button className="btn btn-ghost btn-sm" disabled={off} onClick={() => hacer(it, "descartar")} title={t("Only removes it from this list", "Solo lo quita de esta lista")}>✖ {t("Dismiss", "Descartar")}</button>
      </div>
    );
  };

  const total = agendadas.length + fallidas.length;

  return (
    <div>
      <div className="stat-pills">
        <div className="stat-pill">
          <b style={{ color: atrasadas ? "var(--red)" : agendadas.length ? "var(--accent)" : undefined }}>{agendadas.length}</b>
          <span>{t("Scheduled calls", "Llamadas agendadas")}</span>
        </div>
        <div className="stat-pill">
          <b style={{ color: fallidas.length ? "var(--amber)" : undefined }}>{fallidas.length}</b>
          <span>{t("Voicemail / call back", "Buzón / volver a llamar")}</span>
        </div>
      </div>

      {ready && total === 0 && (
        <div className="card"><div className="empty">{t("🎉 No pending calls.", "🎉 No hay llamadas pendientes.")}</div></div>
      )}

      {agendadas.length > 0 && (
        <div className="card today-sec">
          <h2>📅 {t("Scheduled calls", "Llamadas agendadas")} <span className="cnt">{agendadas.length}</span></h2>
          {agendadas.map((it) => (
            <div key={it.c.id} className={"mini-row" + (it.atrasada ? " warn" : "")}>
              <div>
                {nameBtn(it)} <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {it.c.role} · {stageOf(stages, it.c.status).label}</span>
                <div style={{ fontSize: 12.5, marginTop: 2 }}>
                  <span style={{ color: it.atrasada ? "var(--red)" : "var(--accent)", fontWeight: 700 }}>
                    {it.atrasada ? "⚠ " + t("Pending since", "Pendiente desde") : "☎ " + t("Scheduled for", "Agendada para")} {fmtDateTime(it.cuando)}
                  </span>
                  {it.intentos > 0 && <span style={{ color: "var(--gray)" }}> · {it.intentos} {t("failed before", "sin conectar antes")}</span>}
                  {contacto(it)}
                </div>
              </div>
              {botones(it)}
            </div>
          ))}
        </div>
      )}

      {fallidas.length > 0 && (
        <div className="card today-sec">
          <h2>📞 {t("Voicemail / call back", "Buzón / volver a llamar")} <span className="cnt">{fallidas.length}</span></h2>
          {fallidas.map((it) => (
            <div key={it.c.id} className="mini-row">
              <div>
                {nameBtn(it)} <span style={{ color: "var(--gray)", fontSize: 12.5 }}>· {it.c.role} · {stageOf(stages, it.c.status).label}</span>
                <div style={{ fontSize: 12.5, marginTop: 2 }}>
                  <span style={{ color: "var(--amber)", fontWeight: 700 }}>{motivo(it.motivo)} · {fmtDateTime(it.ultima)}</span>
                  {it.intentos > 1 && <span style={{ color: "var(--gray)" }}> · {it.intentos} {t("tries", "intentos")}</span>}
                  {it.siguiendoDesde && <span style={{ color: "var(--gray)" }}> · 🔁 {t("following up since", "siguiendo desde")} {fmtDateTime(it.siguiendoDesde)}</span>}
                  {contacto(it)}
                </div>
              </div>
              {botones(it)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
