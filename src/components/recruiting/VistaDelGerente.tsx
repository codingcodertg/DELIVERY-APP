"use client";

import { useState } from "react";
import { useData } from "@/lib/recruiting-data-provider";
import { usePrefs } from "@/lib/prefs";
import {
  agruparParaElGerente, resolucionDelGerente, resolverCandidato, textoDeLaResolucion, type Decision, type GrupoDelGerente,
} from "@/lib/recruiting/vista-del-gerente";
import { fmtDateTime } from "@/lib/recruiting/utils";
import { telefonoEnLaFila } from "@/lib/recruiting/texto-puedo-llamar";
import type { Candidate } from "@/lib/recruiting/types";

/**
 * La vista del gerente de tienda (D-600). Lo que llega en `candidates` ya viene filtrado por la base (183: solo los de
 * su tienda en presencial / contratado / descartado); aquí solo se agrupa (Hoy, Próximos, Pendientes, Resueltos) y se
 * resuelve: «✅ Contratar» o «❌ No contratar» con razón obligatoria. Nada más del módulo se ofrece a este rol.
 */
export function VistaDelGerente() {
  const { candidates, stages, contactsFor, recruiters, updateCandidate, addContact, openResumeFile, notify, me } = useData();
  const { t } = usePrefs();
  const grupos = agruparParaElGerente(candidates, stages);
  const orden: { id: GrupoDelGerente; titulo: string; vacio: string }[] = [
    { id: "hoy", titulo: t("Today", "Hoy"), vacio: t("No interviews today", "Hoy no hay entrevistas") },
    { id: "proximos", titulo: t("Upcoming", "Próximos"), vacio: t("Nothing scheduled", "Nada agendado") },
    { id: "pendientes", titulo: t("Pending decision", "Pendientes de resolver"), vacio: t("Nothing pending", "Nada pendiente") },
    { id: "resueltos", titulo: t("Resolved", "Resueltos"), vacio: t("Nothing resolved yet", "Aún nada resuelto") },
  ];
  const total = candidates.filter((c) => !c.archived).length;

  return (
    <div data-vista-del-gerente>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>🏪 {t("Candidates sent to your store", "Candidatos enviados a tu tienda")}{me?.store ? ` — ${me.store}` : ""}</h2>
        <div className="hint">
          {me?.store
            ? t("You see the candidates scheduled for an in-person interview at your store. Decide hire / no hire after the interview.",
                "Ves los candidatos citados a entrevista presencial en tu tienda. Tras la entrevista, decide contratar o no.")
            : t("Your profile has no store yet: ask the admin to set it in the hub (Users), and candidates will show up here.",
                "Tu perfil aún no tiene tienda: pide al admin que la ponga en el hub (Usuarios) y aquí aparecerán los candidatos.")}
        </div>
      </div>
      {total === 0 && <div className="empty">{t("No candidates for your store yet.", "Aún no hay candidatos para tu tienda.")}</div>}
      {orden.map((g) => (
        <section key={g.id} style={{ marginBottom: 18 }} data-grupo={g.id}>
          <h3 style={{ margin: "8px 0" }}>{g.titulo} <span style={{ color: "var(--gray)", fontWeight: 400 }}>({grupos[g.id].length})</span></h3>
          {grupos[g.id].length === 0 ? <div className="hint">{g.vacio}</div> : grupos[g.id].map((c) => (
            <TarjetaDelGerente
              key={c.id} c={c} resuelto={g.id === "resueltos"}
              resolucion={resolucionDelGerente(contactsFor(c.id), c.id)}
              nombreDe={(id) => recruiters.find((r) => r.id === id)?.full_name ?? null}
              abrirCv={() => openResumeFile(c.id)}
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

function TarjetaDelGerente({ c, resuelto, resolucion, nombreDe, abrirCv, resolver }: {
  c: Candidate; resuelto: boolean;
  resolucion: ReturnType<typeof resolucionDelGerente>;
  nombreDe: (id: string | null) => string | null;
  abrirCv: () => void;
  resolver: (decision: Decision, razon: string) => Promise<boolean>;
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
      {resolucion && (
        <div className="sent-tag" style={{ marginTop: 6 }}>✓ {textoDeLaResolucion(resolucion, lang, nombreDe(resolucion.por))}</div>
      )}
      {!resuelto && (
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
            <button className="btn btn-green btn-sm" onClick={() => setDecidiendo("hire")}>✅ {t("Hire", "Contratar")}</button>
            <button className="btn btn-danger btn-sm" onClick={() => setDecidiendo("no_hire")}>❌ {t("No hire", "No contratar")}</button>
          </div>
        )
      )}
    </div>
  );
}
