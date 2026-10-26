"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import { puedeContratar } from "@/lib/recruiting/contratar";
import { hireCandidate } from "@/app/recruiting/actions/contratar";
import type { Candidate } from "@/lib/recruiting/types";

/**
 * «Hire» en la ficha del candidato (D-688, 201). Gerente y admin de RR. HH.: pasa el candidato a la etapa de
 * contratado, crea (o reusa) su expediente y, si se marca, pide al admin que le cree el usuario.
 */
export function BotonContratar({ c }: { c: Candidate }) {
  const { me, stages, updateCandidate, notify } = useData();
  const { t } = usePrefs();
  const [abierto, setAbierto] = useState(false);
  const [pedir, setPedir] = useState(true);
  const [nota, setNota] = useState("");
  const [enCurso, setEnCurso] = useState(false);
  if (!puedeContratar(me?.role)) return null;

  const etapa = stages.find((s) => s.key === "hired") ?? stages.find((s) => s.type === "won");

  async function contratar() {
    setEnCurso(true);
    try {
      if (etapa && c.status !== etapa.key) await updateCandidate(c.id, { status: etapa.key });
      const r = await hireCandidate({ candidateId: c.id, requestUser: pedir, note: nota });
      if (!r.ok) { notify(r.message); return; }
      let msg = r.creado ? t("Hired ✓ — employee file created", "Contratado ✓ — expediente creado")
        : t("Hired ✓ — employee file already existed", "Contratado ✓ — el expediente ya existía");
      if (r.solicitado) msg += t(" · user request sent to admins", " · solicitud de usuario enviada a los admins");
      else if (pedir && r.sinSolicitudes) msg += t(" · user requests not available yet (migration 201)", " · solicitudes de usuario aún no disponibles (migración 201)");
      notify(msg);
      setAbierto(false);
    } finally { setEnCurso(false); }
  }

  if (!abierto) {
    return (
      <button className="btn btn-green" onClick={() => setAbierto(true)}>
        🤝 {c.status === etapa?.key ? t("Hired · employee file", "Contratado · expediente") : t("Hire", "Contratar")}
      </button>
    );
  }
  return (
    <div style={{ flexBasis: "100%", border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 10, display: "grid", gap: 8 }}>
      <strong>{t("Hire", "Contratar")} {c.name}</strong>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={pedir} onChange={(e) => setPedir(e.target.checked)} />
        {t("Ask an admin to create their user", "Pedir a un admin que le cree el usuario")}
      </label>
      {pedir && (
        <input className="input" placeholder={t("Note for the admin (optional)", "Nota para el admin (opcional)")}
          value={nota} onChange={(e) => setNota(e.target.value)} />
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-green" disabled={enCurso} onClick={contratar}>{enCurso ? "…" : t("Confirm hire", "Confirmar contratación")}</button>
        <button className="btn btn-ghost" disabled={enCurso} onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
      </div>
    </div>
  );
}
