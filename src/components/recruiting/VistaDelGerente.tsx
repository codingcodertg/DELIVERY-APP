"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import {
  GRUPOS_QUE_SE_PINTAN, agruparParaElGerente, decisionesPosibles, resolucionDelGerente, resolverCandidato, textoDeLaResolucion, type Decision, type GrupoQueSePinta,
} from "@/lib/recruiting/vista-del-gerente";
import { fmtDateTime } from "@/lib/recruiting/utils";
import { telefonoEnLaFila } from "@/lib/recruiting/texto-puedo-llamar";
import type { Attachment, Candidate } from "@/lib/recruiting/types";

/**
 * La vista del gerente de tienda (D-600). Lo que llega en `candidates` ya viene filtrado por la base (183: solo los de
 * su tienda en presencial / contratado / descartado); aquí solo se agrupa (Hoy, Próximos, Pasados este mes — D-627) y
 * se resuelve: «✅ Contratar» o «❌ No contratar» con razón obligatoria; a un pasado ya resuelto se le ofrece la otra
 * decisión (`decisionesPosibles`). Nada más del módulo se ofrece a este rol.
 */
export function VistaDelGerente() {
  const { candidates, stages, contactsFor, recruiters, updateCandidate, addContact, openResumeFile, attachmentsFor, addAttachment, removeAttachment, openAttachment, notify, me } = useData();
  const { t } = usePrefs();
  const grupos = agruparParaElGerente(candidates, stages);
  const titulos: Record<GrupoQueSePinta, { titulo: string; vacio: string }> = {
    hoy: { titulo: t("Today", "Hoy"), vacio: t("No interviews today", "Hoy no hay entrevistas") },
    proximos: { titulo: t("Upcoming", "Próximos"), vacio: t("Nothing scheduled", "Nada agendado") },
    pasados_del_mes: { titulo: t("Earlier this month", "Pasados este mes"), vacio: t("No earlier interviews this month", "Este mes no hubo entrevistas anteriores") },
  };
  // D-606 dejó solo Hoy y Próximos; D-627 añade los pasados de este mes (no los de meses anteriores).
  const orden = GRUPOS_QUE_SE_PINTAN.map((id) => ({ id, ...titulos[id] }));
  const total = GRUPOS_QUE_SE_PINTAN.reduce((n, g) => n + grupos[g].length, 0);

  return (
    <div data-vista-del-gerente>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🏪 {t("Candidates sent to your store", "Candidatos enviados a tu tienda")}{me?.store ? ` — ${me.store}` : ""}</h2>
        <div className="hint">
          {me?.store
            ? t("You see the candidates scheduled for an in-person interview at your store, and the ones already interviewed this month. Decide hire / no hire, change your mind, and attach documents.",
                "Ves los candidatos citados a entrevista presencial en tu tienda y los que ya pasaron este mes. Decide contratar o no, cambia de opinión y adjunta documentos.")
            : t("Your profile has no store yet: ask the admin to set it in the hub (Users), and candidates will show up here.",
                "Tu perfil aún no tiene tienda: pide al admin que la ponga en el hub (Usuarios) y aquí aparecerán los candidatos.")}
        </div>
      </div>
      {total === 0 && <div className="empty">{t("No interviews for your store this month, today or upcoming.", "Ni este mes, ni hoy, ni próximamente hay entrevistas en tu tienda.")}</div>}
      {orden.map((g) => (
        <section key={g.id} style={{ marginBottom: 18 }} data-grupo={g.id}>
          <h3 style={{ margin: "8px 0" }}>{g.titulo} <span style={{ color: "var(--gray)", fontWeight: 400 }}>({grupos[g.id].length})</span></h3>
          {grupos[g.id].length === 0 ? <div className="hint">{g.vacio}</div> : grupos[g.id].map((c) => (
            <TarjetaDelGerente
              key={c.id} c={c}
              decisiones={decisionesPosibles(c, stages)}
              estado={(() => { const s = stages.find((x) => x.key === c.status); return s && s.type !== "active" ? s.label : null; })()}
              resolucion={resolucionDelGerente(contactsFor(c.id), c.id)}
              nombreDe={(id) => recruiters.find((r) => r.id === id)?.full_name ?? null}
              abrirCv={() => openResumeFile(c.id)}
              // D-607: documentos del candidato (formularios, identificación…) que el gerente adjunta y abre desde aquí.
              adjuntos={attachmentsFor(c.id)}
              adjuntar={(f) => addAttachment(c.id, f)}
              abrirAdjunto={(id) => openAttachment(id)}
              quitarAdjunto={(a) => (a.created_by && a.created_by === me?.id ? removeAttachment(a.id) : Promise.resolve())}
              yo={me?.id ?? null}
              resolver={async (decision, razon) => {
                const r = resolverCandidato(decision, razon, stages);
                if (!r.ok) {
                  notify(r.motivo === "sin-razon" ? t("Write the reason", "Escribe la razón") : t("Pipeline stage missing", "Falta la etapa en el pipeline"));
                  return false;
                }
                await updateCandidate(c.id, r.patch);
                await addContact(c.id, r.contacto);
                notify(decision === "hire" ? t("Marked as hired ✓", "Marcado como contratado ✓") : t("Marked as not hired ✓", "Marcado como no contratado ✓"));
                return true;
              }}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function TarjetaDelGerente({ c, decisiones, estado, resolucion, nombreDe, abrirCv, resolver, adjuntos, adjuntar, abrirAdjunto, quitarAdjunto, yo }: {
  c: Candidate;
  /** Los botones que se ofrecen (`decisionesPosibles`): las dos en curso; la contraria si ya está resuelto. */
  decisiones: Decision[];
  /** La etapa (contratado / descartado) si ya no está en curso, para que se vea en qué quedó. */
  estado: string | null;
  resolucion: ReturnType<typeof resolucionDelGerente>;
  nombreDe: (id: string | null) => string | null;
  abrirCv: () => void;
  resolver: (decision: Decision, razon: string) => Promise<boolean>;
  adjuntos: Attachment[];
  adjuntar: (f: File) => Promise<void>;
  abrirAdjunto: (id: string) => Promise<void>;
  /** Solo quita los que subió el propio gerente; los del reclutador se quedan. */
  quitarAdjunto: (a: Attachment) => Promise<void>;
  yo: string | null;
}) {
  const { t, lang } = usePrefs();
  const [decidiendo, setDecidiendo] = useState<Decision | null>(null);
  const [razon, setRazon] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const tel = telefonoEnLaFila(c.phone);
  const nota = c.interview?.generalNotes?.trim();

  const confirmar = async () => {
    if (!decidiendo) return;
    setOcupado(true);
    try {
      if (await resolver(decidiendo, razon)) { setDecidiendo(null); setRazon(""); }
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 8 }} data-candidato={c.id}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: 16 }}>{c.name}</strong>
        <span style={{ color: "var(--gray)" }}>🤝 {c.inperson_date ? fmtDateTime(c.inperson_date) : t("No date", "Sin fecha")}</span>
      </div>
      <div className="cand-meta" style={{ marginTop: 4 }}>
        <span>💼 {c.role}</span>
        {tel && <a className="link-tel" href={tel.href}>📞 {tel.texto}</a>}
        {c.resume_name && <button className="btn btn-ghost btn-sm" onClick={abrirCv}>📎 {t("Resume", "Currículum")}</button>}
      </div>
      {nota && <div className="hint" style={{ marginTop: 6 }}>📝 {t("Recruiter's note", "Nota del reclutador")}: {nota}</div>}
      {/* D-607: «dale la opción para attached documents de ellos como forms y así». Mismo camino que la ficha (bucket resumes + tabla attachments). */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }} data-adjuntos-del-gerente>
        {adjuntos.map((a) => (
          <span key={a.id} style={{ display: "inline-flex", alignItems: "center" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void abrirAdjunto(a.id)}>📎 {a.name}</button>
            {a.created_by && a.created_by === yo && (
              <button className="btn btn-ghost btn-sm" title={t("Remove", "Quitar")} onClick={() => { if (confirm(t("Remove ", "¿Quitar ") + a.name + "?")) void quitarAdjunto(a); }}>✕</button>
            )}
          </span>
        ))}
        <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
          ＋ {t("Attach document", "Adjuntar documento")}
          <input type="file" style={{ display: "none" }} data-adjuntar-documento
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void adjuntar(f); e.target.value = ""; }} />
        </label>
      </div>
      {estado && <div className="hint" style={{ marginTop: 6 }} data-estado-del-candidato>{t("Status", "Estado")}: {estado}{c.discard_reason && decisiones.includes("hire") ? ` · ${c.discard_reason}` : ""}</div>}
      {resolucion && (
        <div className="sent-tag" style={{ marginTop: 6 }}>✓ {textoDeLaResolucion(resolucion, lang, nombreDe(resolucion.por))}</div>
      )}
      {decisiones.length > 0 && (
        decidiendo ? (
          <div style={{ marginTop: 8 }}>
            <label>{decidiendo === "hire" ? t("Comment (optional)", "Comentario (opcional)") : t("Why not? (required)", "¿Por qué no? (obligatorio)")}</label>
            <textarea rows={2} value={razon} onChange={(e) => setRazon(e.target.value)} placeholder={decidiendo === "hire" ? "" : t("e.g. did not show up / did not pass the test", "p. ej. no se presentó / no pasó la prueba")} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <button className={"btn " + (decidiendo === "hire" ? "btn-green" : "btn-danger")} onClick={confirmar} disabled={ocupado}>
                {decidiendo === "hire" ? "✅ " + t("Confirm hire", "Confirmar contratación") : "❌ " + t("Confirm no hire", "Confirmar no contratar")}
              </button>
              <button className="btn btn-ghost" onClick={() => { setDecidiendo(null); setRazon(""); }} disabled={ocupado}>{t("Cancel", "Cancelar")}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {decisiones.includes("hire") && <button className="btn btn-green btn-sm" onClick={() => setDecidiendo("hire")}>✅ {t("Hire", "Contratar")}</button>}
            {decisiones.includes("no_hire") && <button className="btn btn-danger btn-sm" onClick={() => setDecidiendo("no_hire")}>❌ {t("No hire", "No contratar")}</button>}
          </div>
        )
      )}
    </div>
  );
}
