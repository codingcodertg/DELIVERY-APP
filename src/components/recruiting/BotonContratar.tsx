"use client";

import { mensajeDeError } from "@/lib/mensaje-de-error";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { MODO_DEMO } from "@/lib/recruiting/modo-demo";
import { useData } from "@/lib/recruiting-data-provider";
import { ROLES_DE_INVITE, accionDeContratacion, precargaDeUsuario, puedeContratar, type RolDeInvite } from "@/lib/recruiting/contratar";
import { closeUserRequestsForFile, fileIdDeCandidato, hireCandidate } from "@/app/recruiting/actions/contratar";
import { correoEnUso } from "@/app/recruiting/actions/hr";
import { esCorreoValido, mensajeCorreoEnUso } from "@/lib/recruiting/correo-unico";
import { roleLabel } from "@/lib/constants";
import type { Candidate } from "@/lib/recruiting/types";

/**
 * «Hire» en la ficha del candidato (D-688, 201). Gerente y admin de RR. HH.: pasa el candidato a la etapa de
 * contratado, crea (o reusa) su expediente y deja la solicitud «créale el usuario».
 *
 * D-710: además crea la cuenta del hub en el acto, por el mismo /api/invite de Usuarios (que exige admin del hub:
 * no hay una segunda regla de permisos aquí), la enlaza al expediente con /api/recruiting/usuario-de-empleado (que
 * quita el expediente vacío que la 106 crea con la cuenta) y cierra la solicitud. Si quien contrata no es admin del
 * hub, o la creación falla, la solicitud se queda pendiente en «Usuarios por crear», como antes, y se dice.
 */
/**
 * @param onActivoChange avisa a la ficha que hay un alta en curso (ventana abierta o contraseña a la vista), para que
 *        no se cierre al hacer clic fuera y perder el correo que se está escribiendo.
 */
export function BotonContratar({ c, onActivoChange }: { c: Candidate; onActivoChange?: (activo: boolean) => void }) {
  const { me, stages, updateCandidate, notify } = useData();
  const { t, lang } = usePrefs();
  const router = useRouter();
  const pre = precargaDeUsuario(c);
  const [abierto, setAbierto] = useState(false);
  const [crear, setCrear] = useState(true);
  const [email, setEmail] = useState(pre.email);
  const [usuario, setUsuario] = useState(pre.username);
  const [rol, setRol] = useState<RolDeInvite>(pre.role ?? "sales");
  const [nota, setNota] = useState("");
  const [enCurso, setEnCurso] = useState(false);
  const [hecho, setHecho] = useState<{ signInWith: string; password: string; canReset: boolean } | null>(null);
  // El expediente recién creado/encontrado, para llevar al perfil al terminar.
  const [fileIdHecho, setFileIdHecho] = useState<string | null>(null);

  // La ficha no debe cerrarse al hacer clic fuera mientras se captura el correo (se perdía lo escrito).
  const activo = abierto || !!hecho;
  useEffect(() => { onActivoChange?.(activo); }, [activo, onActivoChange]);
  useEffect(() => () => onActivoChange?.(false), [onActivoChange]);

  if (!puedeContratar(me?.role)) return null;

  const etapa = stages.find((s) => s.key === "hired") ?? stages.find((s) => s.type === "won");

  /** Lleva al perfil del empleado (o a la lista si aún no se puede enlazar — sin migración 201). */
  function irAlPerfil(fileId: string | null) {
    router.push(fileId ? `/recruiting/employees?ficha=${encodeURIComponent(fileId)}` : "/recruiting/employees");
  }

  /** «Ver perfil» de un candidato ya contratado: resuelve su expediente y abre su ficha. */
  async function verPerfil() {
    setEnCurso(true);
    try {
      const r = await fileIdDeCandidato(c.id);
      irAlPerfil(r.ok ? r.fileId : null);
    } finally { setEnCurso(false); }
  }

  /** Crea la cuenta y la enlaza. Devuelve `{ texto, ok }`: `ok` false si el correo ya era de otra persona. */
  async function creaCuenta(fileId: string): Promise<{ texto: string; ok: boolean }> {
    // Correo de trabajo único: si ya es de otra persona, no se crea la cuenta y se dice de quién (con nombre).
    const correo = email.trim();
    if (esCorreoValido(correo)) {
      const chk = await correoEnUso(correo);
      if (chk.ok && chk.enUso) {
        const m = mensajeCorreoEnUso(chk.nombre);
        return { ok: false, texto: " · " + t(m.en, m.es) };
      }
    }
    const res = await fetch("/api/invite", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: pre.full_name, email: email.trim() || undefined, username: usuario.trim() || undefined, role: rol, store: pre.store }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.status === 403) {
      return { ok: false, texto: t(" · you are not a hub admin: user request left in «Users to create»", " · no eres admin del hub: la solicitud queda en «Usuarios por crear»") };
    }
    if (!res.ok || !j.id) {
      return { ok: false, texto: t(` · user NOT created (${j.error ?? res.status}): request left pending`, ` · usuario NO creado (${j.error ?? res.status}): la solicitud queda pendiente`) };
    }
    setHecho({ signInWith: j.signInWith || j.email || "", password: j.password, canReset: !!j.can_reset_own_password });
    const link = await fetch("/api/recruiting/usuario-de-empleado", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId, profileId: j.id }),
    });
    if (!link.ok) {
      const e = await link.json().catch(() => ({}));
      return { ok: true, texto: t(` · user created, but NOT linked to the file (${e.error ?? link.status})`, ` · usuario creado, pero NO enlazado al expediente (${e.error ?? link.status})`) };
    }
    const cierre = await closeUserRequestsForFile(fileId);
    return {
      ok: true,
      texto: cierre.ok
        ? t(" · user created and linked ✓", " · usuario creado y enlazado ✓")
        : t(" · user created and linked ✓ (request still open)", " · usuario creado y enlazado ✓ (la solicitud sigue abierta)"),
    };
  }

  async function contratar() {
    setEnCurso(true);
    try {
      if (etapa && c.status !== etapa.key) await updateCandidate(c.id, { status: etapa.key });
      // D-932: en el demo se contrata (cambia la etapa) y no hay expediente ni usuario del hub: viven en el servidor.
      if (MODO_DEMO) { notify(t("Hired ✓ · demo: no employee file or hub user", "Contratado ✓ · demo: sin expediente ni usuario del hub")); setAbierto(false); return; }
      // La solicitud se deja siempre que se quiere usuario: si crear la cuenta falla, es la que queda pendiente.
      const r = await hireCandidate({ candidateId: c.id, requestUser: crear, note: nota });
      if (!r.ok) { notify(mensajeDeError(r.message)); return; }
      setFileIdHecho(r.fileId);
      let msg = r.creado ? t("Hired ✓ — employee file created", "Contratado ✓ — expediente creado")
        : t("Hired ✓ — employee file already existed", "Contratado ✓ — el expediente ya existía");
      let cuentaCreada = false;
      if (crear && r.profileId) msg += t(" · already had a hub user", " · ya tenía usuario del hub");
      else if (crear) { const rc = await creaCuenta(r.fileId); msg += rc.texto; cuentaCreada = rc.ok; }
      if (crear && r.sinSolicitudes) msg += t(" · user requests not available yet (migration 201)", " · solicitudes de usuario aún no disponibles (migración 201)");
      notify(msg);
      // Al terminar bien, directo al perfil del empleado. Si se mostró la contraseña, se va desde «Listo» para no
      // esconderla; si el correo estaba duplicado (cuentaCreada false), se queda para corregirlo.
      const esperaContrasena = crear && !r.profileId && cuentaCreada;
      if (!esperaContrasena && !(crear && !r.profileId && !cuentaCreada)) { setAbierto(false); irAlPerfil(r.fileId); }
    } finally { setEnCurso(false); }
  }

  const accion = accionDeContratacion(c.status, etapa?.key);

  if (!abierto) {
    // Punto 3: ya contratado = hay expediente; se ofrece «Ver perfil», no «Contratar» otra vez (evita duplicados).
    if (accion === "ver-perfil") {
      return (
        <button className="btn btn-ghost" disabled={enCurso} onClick={verPerfil}>
          👤 {enCurso ? "…" : t("View profile", "Ver perfil")}
        </button>
      );
    }
    return (
      <button className="btn btn-green" onClick={() => setAbierto(true)}>
        🤝 {t("Hire", "Contratar")}
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
          <button className="btn btn-primary" onClick={() => { setHecho(null); setAbierto(false); irAlPerfil(fileIdHecho); }}>{t("Done — view profile", "Listo — ver perfil")}</button>
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
