"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/recruiting-data-provider";
import { ROLES_DE_INVITE, precargaDeUsuario, puedeContratar, type RolDeInvite } from "@/lib/recruiting/contratar";
import { closeUserRequestsForFile, hireCandidate } from "@/app/recruiting/actions/contratar";
import { roleLabel } from "@/lib/constants";
import type { Candidate } from "@/lib/recruiting/types";

/**
 * «Hire» en la ficha del candidato (D-688, 201). Gerente y admin de RR. HH.: pasa el candidato a la etapa de
 * contratado, crea (o reusa) su expediente y deja la solicitud «créale el usuario».
 *
 * D-NEXT: además crea la cuenta del hub en el acto, por el mismo /api/invite de Usuarios (que exige admin del hub:
 * no hay una segunda regla de permisos aquí), la enlaza al expediente con /api/recruiting/usuario-de-empleado (que
 * quita el expediente vacío que la 106 crea con la cuenta) y cierra la solicitud. Si quien contrata no es admin del
 * hub, o la creación falla, la solicitud se queda pendiente en «Usuarios por crear», como antes, y se dice.
 */
export function BotonContratar({ c }: { c: Candidate }) {
  const { me, stages, updateCandidate, notify } = useData();
  const { t, lang } = usePrefs();
  const pre = precargaDeUsuario(c);
  const [abierto, setAbierto] = useState(false);
  const [crear, setCrear] = useState(true);
  const [email, setEmail] = useState(pre.email);
  const [usuario, setUsuario] = useState(pre.username);
  const [rol, setRol] = useState<RolDeInvite>(pre.role ?? "sales");
  const [nota, setNota] = useState("");
  const [enCurso, setEnCurso] = useState(false);
  const [hecho, setHecho] = useState<{ signInWith: string; password: string; canReset: boolean } | null>(null);
  if (!puedeContratar(me?.role)) return null;

  const etapa = stages.find((s) => s.key === "hired") ?? stages.find((s) => s.type === "won");

  /** Crea la cuenta y la enlaza. Devuelve el texto que se añade al aviso. */
  async function creaCuenta(fileId: string): Promise<string> {
    const res = await fetch("/api/invite", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: pre.full_name, email: email.trim() || undefined, username: usuario.trim() || undefined, role: rol, store: pre.store }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 403) {
      return t(" · you are not a hub admin: user request left in «Users to create»", " · no eres admin del hub: la solicitud queda en «Usuarios por crear»");
    }
    if (!res.ok || !j.id) {
      return t(` · user NOT created (${j.error ?? res.status}): request left pending`, ` · usuario NO creado (${j.error ?? res.status}): la solicitud queda pendiente`);
    }
    setHecho({ signInWith: j.signInWith || j.email || "", password: j.password, canReset: !!j.can_reset_own_password });
    const link = await fetch("/api/recruiting/usuario-de-empleado", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId, profileId: j.id }),
    });
    if (!link.ok) {
      const e = await link.json().catch(() => ({}));
      return t(` · user created, but NOT linked to the file (${e.error ?? link.status})`, ` · usuario creado, pero NO enlazado al expediente (${e.error ?? link.status})`);
    }
    const cierre = await closeUserRequestsForFile(fileId);
    return cierre.ok
      ? t(" · user created and linked ✓", " · usuario creado y enlazado ✓")
      : t(" · user created and linked ✓ (request still open)", " · usuario creado y enlazado ✓ (la solicitud sigue abierta)");
  }

  async function contratar() {
    setEnCurso(true);
    try {
      if (etapa && c.status !== etapa.key) await updateCandidate(c.id, { status: etapa.key });
      // La solicitud se deja siempre que se quiere usuario: si crear la cuenta falla, es la que queda pendiente.
      const r = await hireCandidate({ candidateId: c.id, requestUser: crear, note: nota });
      if (!r.ok) { notify(r.message); return; }
      let msg = r.creado ? t("Hired ✓ — employee file created", "Contratado ✓ — expediente creado")
        : t("Hired ✓ — employee file already existed", "Contratado ✓ — el expediente ya existía");
      if (crear && r.profileId) msg += t(" · already had a hub user", " · ya tenía usuario del hub");
      else if (crear) msg += await creaCuenta(r.fileId);
      if (crear && r.sinSolicitudes) msg += t(" · user requests not available yet (migration 201)", " · solicitudes de usuario aún no disponibles (migración 201)");
      notify(msg);
    } finally { setEnCurso(false); }
  }

  if (!abierto) {
    return (
      <button className="btn btn-green" onClick={() => setAbierto(true)}>
        🤝 {c.status === etapa?.key ? t("Hired · employee file", "Contratado · expediente") : t("Hire", "Contratar")}
      </button>
    );
  }
  const caja = { flexBasis: "100%", border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 10, display: "grid", gap: 8 } as const;
  if (hecho) {
    // Como en Usuarios: la contraseña se enseña una vez.
    return (
      <div style={caja} data-panel="usuario-creado">
        <strong>{t("User created — give them these", "Usuario creado — dáselos")}</strong>
        <div>{t("Sign in with", "Entrar con")}: <b>{hecho.signInWith}</b></div>
        <div>{t("Password", "Contraseña")}: <b>{hecho.password}</b></div>
        {!hecho.canReset && <div className="hint">{t("No email: only an admin can reset their password.", "Sin correo: solo un admin puede cambiarle la contraseña.")}</div>}
        <div className="hint">{t("Shown only once.", "Solo se enseña esta vez.")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(`${hecho.signInWith} / ${hecho.password}`)}>{t("Copy", "Copiar")}</button>
          <button className="btn btn-primary" onClick={() => { setHecho(null); setAbierto(false); }}>{t("Done", "Listo")}</button>
        </div>
      </div>
    );
  }
  return (
    <div style={caja}>
      <strong>{t("Hire", "Contratar")} {c.name}</strong>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={crear} onChange={(e) => setCrear(e.target.checked)} />
        {t("Also create their hub user", "Crear también su usuario del hub")}
      </label>
      {crear && (
        <>
          <input className="input" type="email" placeholder={t("Email", "Correo")} value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder={t("Username (if no email)", "Usuario (si no hay correo)")} value={usuario} onChange={(e) => setUsuario(e.target.value)} />
          <select value={rol} onChange={(e) => setRol(e.target.value as RolDeInvite)} aria-label={t("Role", "Rol")}>
            {ROLES_DE_INVITE.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
          </select>
          {!pre.role && <div className="hint">{t("Role not obvious from the position: check it.", "El puesto no dice el rol: revísalo.")}</div>}
          <input className="input" placeholder={t("Note for the admin if it can't be created now (optional)", "Nota para el admin si no se puede crear ahora (opcional)")}
            value={nota} onChange={(e) => setNota(e.target.value)} />
        </>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-green" disabled={enCurso || (crear && !email.trim() && !usuario.trim())} onClick={contratar}>
          {enCurso ? "…" : t("Confirm hire", "Confirmar contratación")}
        </button>
        <button className="btn btn-ghost" disabled={enCurso} onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
      </div>
    </div>
  );
}
