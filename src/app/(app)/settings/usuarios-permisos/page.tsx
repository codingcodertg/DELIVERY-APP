"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { ROLE_ORDER, roleHome, roleLabel, type ModuleAccessKey } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import {
  MODULOS_DE_GERENTE,
  type CambioDeModulo,
  colorDeRol,
  conteoPorModulo,
  conteoPorRol,
  etiquetaDeModulo,
  modulosDeUsuario,
  planDarLosOcho,
  planToggleModulo,
  resumenDeUsuario,
  tieneModulo,
  todosTienenLosOcho,
  usuariosConModulo,
  usuariosPorRol,
} from "@/lib/hub-usuarios-permisos";

/**
 * «Usuarios y Permisos» (petición 7 y 9 de Roberto, junta 8 nov). Estilo QuickBooks: ver POR USUARIO (qué módulos tiene)
 * o POR ROL / módulo (elige uno y ve a esas personas), más PERMISOS RÁPIDOS en bloque con el botón «dar los 8 de gerente».
 *
 * NO duplica la lista general de usuarios ni «company assets»: enlaza con el expediente de RR. HH. y con Central Hub Monitoring. La
 * regla de qué puede hacer cada quien vive en `src/lib/hub-usuarios-permisos.ts` (puro, con pruebas); esta página solo la
 * pinta y aplica los cambios con los `updateUser…Access` del data-provider.
 *
 * (El candado de pedir contraseña al abrir Permisos queda para después, a propósito.)
 */

type Vista = "usuario" | "rol" | "rapido";

export default function UsuariosYPermisosPage() {
  const data = useData();
  const { me, users, notify } = data;
  const { lang, t } = usePrefs();
  const [vista, setVista] = useState<Vista>("usuario");

  if (!me) return null;
  if (me.role !== "admin") {
    return (
      <>
        <div className="page-head">
          <h2>{t("Users & Permissions", "Usuarios y Permisos")}</h2>
          <Link href={roleHome(me.role)} className="btn btn-primary btn-back-account">← {t("Back to the app", "Volver a la app")}</Link>
        </div>
        <div className="empty">{t("Admins only.", "Solo administradores.")}</div>
      </>
    );
  }

  /** Aplica UN cambio de módulo a UNA persona. Pasa por `updateUserModules` (el mismo camino que el plan en bloque): un
   *  solo grant o revoke. Así la casilla de «Por usuario» y los botones de bloque comparten la escritura que lee la fila
   *  fresca y ajusta los roles de escalafón, sin el «lost update» de los updaters por módulo (D-936). */
  async function aplicar(c: CambioDeModulo): Promise<void> {
    await data.updateUserModules(c.userId, c.conceder ? { grant: [c.key] } : { revoke: [c.key] });
  }

  /** Agrupa el plan por persona y llama `updateUserModules` UNA vez por cada una, con todos sus grant/revoke juntos: así
   *  conceder varios módulos a la misma persona ya no se pisa entre sí. Solo da por hecho si TODAS resultaron ok. */
  async function aplicarPlan(plan: CambioDeModulo[], hechoMsg: string) {
    if (plan.length === 0) { notify(t("Nothing to change.", "Nada que cambiar.")); return; }
    const porUsuario = new Map<string, { grant: ModuleAccessKey[]; revoke: ModuleAccessKey[] }>();
    for (const c of plan) {
      const e = porUsuario.get(c.userId) ?? { grant: [], revoke: [] };
      (c.conceder ? e.grant : e.revoke).push(c.key);
      porUsuario.set(c.userId, e);
    }
    let todoOk = true;
    for (const [userId, cambios] of porUsuario) {
      const { ok } = await data.updateUserModules(userId, cambios);
      if (!ok) todoOk = false;
    }
    notify(todoOk ? hechoMsg : t("Some changes could not be saved.", "Algunos cambios no se pudieron guardar."));
  }

  return (
    <>
      <div className="page-head">
        <h2>🛡 {t("Users & Permissions", "Usuarios y Permisos")}</h2>
        <Link href={roleHome(me.role)} className="btn btn-primary btn-back-account">← {t("Back to the app", "Volver a la app")}</Link>
      </div>

      <p className="hint" style={{ marginTop: 0 }}>
        {t(
          "By user (what each person can open), by role or module (who has it), and quick bulk changes. Links to each employee's HR file and to Central Hub Monitoring.",
          "Por usuario (qué puede abrir cada quien), por rol o módulo (quién lo tiene) y cambios rápidos en bloque. Enlaza con el expediente de RR. HH. de cada empleado y con Central Hub Monitoring.",
        )}
      </p>

      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {([["usuario", t("By user", "Por usuario")], ["rol", t("By role / module", "Por rol / módulo")], ["rapido", t("Quick permissions", "Permisos rápidos")]] as [Vista, string][]).map(([k, label]) => (
          <button key={k} className={`btn ${vista === k ? "btn-primary" : ""}`} onClick={() => setVista(k)}>{label}</button>
        ))}
      </div>

      {vista === "usuario" && <PorUsuario users={users} lang={lang} t={t} aplicar={aplicar} />}
      {vista === "rol" && <PorRol users={users} lang={lang} t={t} />}
      {vista === "rapido" && <PermisosRapidos users={users} lang={lang} t={t} aplicarPlan={aplicarPlan} />}
    </>
  );
}

type TFn = (en: string, es: string) => string;
type Lang = "en" | "es";
type Users = ReturnType<typeof useData>["users"];

// ---------------------------------------------------------------------------------------------------------------
// Por usuario
// ---------------------------------------------------------------------------------------------------------------

function PorUsuario({ users, lang, t, aplicar }: { users: Users; lang: Lang; t: TFn; aplicar: (c: CambioDeModulo) => Promise<void> }) {
  const [sel, setSel] = useState<string | null>(null);
  const u = users.find((x) => x.id === sel) ?? null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 2fr", gap: 16 }}>
      <div className="card" style={{ maxHeight: 520, overflow: "auto" }}>
        {[...users].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((x) => (
          <button
            key={x.id}
            className={`btn ${sel === x.id ? "btn-primary" : ""}`}
            style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
            onClick={() => setSel(x.id)}
          >
            {x.full_name} <span style={{ color: colorDeRol(x.role) }}>· {roleLabel(x.role, lang)}</span>
          </button>
        ))}
      </div>

      <div className="card">
        {!u ? (
          <div className="empty">{t("Pick a person on the left.", "Elige una persona a la izquierda.")}</div>
        ) : (
          <FichaDeUsuario u={u} lang={lang} t={t} aplicar={aplicar} />
        )}
      </div>
    </div>
  );
}

function FichaDeUsuario({ u, lang, t, aplicar }: { u: Users[number]; lang: Lang; t: TFn; aplicar: (c: CambioDeModulo) => Promise<void> }) {
  const r = resumenDeUsuario(u, lang);
  return (
    <>
      <h2 style={{ marginTop: 0 }}>{u.full_name}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        <span style={{ color: colorDeRol(u.role) }}>{r.rolTexto}</span>
        {u.store ? ` · ${u.store}` : ""}
      </p>

      <h3>{t("Modules", "Módulos")}</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {MODULOS_DE_GERENTE.map((key) => {
          const tiene = tieneModulo(u, key);
          const fijo = u.role === "admin"; // el admin los tiene por su rol: no se quitan aquí
          return (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, opacity: fijo ? 0.7 : 1 }}>
              <input
                type="checkbox"
                checked={tiene}
                disabled={fijo}
                onChange={(e) => aplicar({ userId: u.id, key, conceder: e.target.checked })}
              />
              {tiene ? "✅" : "⬜"} {etiquetaDeModulo(key, lang)}
            </label>
          );
        })}
      </div>
      {u.role === "admin" && (
        <p className="hint">{t("Admins have every module through their role.", "Los administradores tienen todos los módulos por su rol.")}</p>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <Link className="btn" href={`/recruiting/employees?user=${u.id}`}>📁 {t("HR file", "Expediente de RR. HH.")}</Link>
        <Link className="btn" href="/security">🔐 {t("Central Hub Monitoring", "Central Hub Monitoring")}</Link>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Por rol / módulo
// ---------------------------------------------------------------------------------------------------------------

function PorRol({ users, lang, t }: { users: Users; lang: Lang; t: TFn }) {
  const [tipo, setTipo] = useState<"rol" | "modulo">("rol");
  const [rol, setRol] = useState<UserRole>(ROLE_ORDER[0]);
  const [modulo, setModulo] = useState<ModuleAccessKey>(MODULOS_DE_GERENTE[0]);
  const conteoR = useMemo(() => conteoPorRol(users), [users]);
  const conteoM = useMemo(() => conteoPorModulo(users), [users]);
  const lista = tipo === "rol" ? usuariosPorRol(users, rol) : usuariosConModulo(users, modulo);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) 2fr", gap: 16 }}>
      <div className="card" style={{ maxHeight: 520, overflow: "auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className={`btn ${tipo === "rol" ? "btn-primary" : ""}`} onClick={() => setTipo("rol")}>{t("Roles", "Roles")}</button>
          <button className={`btn ${tipo === "modulo" ? "btn-primary" : ""}`} onClick={() => setTipo("modulo")}>{t("Modules", "Módulos")}</button>
        </div>
        {tipo === "rol"
          ? conteoR.map(({ role, n }) => (
              <button key={role} className={`btn ${rol === role ? "btn-primary" : ""}`} style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }} onClick={() => setRol(role)}>
                <span style={{ color: colorDeRol(role) }}>{roleLabel(role, lang)}</span> · {n}
              </button>
            ))
          : conteoM.map(({ key, n }) => (
              <button key={key} className={`btn ${modulo === key ? "btn-primary" : ""}`} style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }} onClick={() => setModulo(key)}>
                {etiquetaDeModulo(key, lang)} · {n}
              </button>
            ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          {tipo === "rol" ? roleLabel(rol, lang) : etiquetaDeModulo(modulo, lang)} · {lista.length}
        </h3>
        {lista.length === 0 ? (
          <div className="empty">{t("Nobody here.", "Nadie aquí.")}</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {lista.map((x) => (
              <li key={x.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line, #eee)" }}>
                {x.full_name} <span className="hint">· {roleLabel(x.role, lang)}{x.store ? ` · ${x.store}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Permisos rápidos (bulk)
// ---------------------------------------------------------------------------------------------------------------

function PermisosRapidos({ users, lang, t, aplicarPlan }: { users: Users; lang: Lang; t: TFn; aplicarPlan: (plan: CambioDeModulo[], msg: string) => Promise<void> }) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [modulo, setModulo] = useState<ModuleAccessKey>(MODULOS_DE_GERENTE[0]);
  const elegidos = users.filter((u) => marcados.has(u.id));

  function toggle(id: string) {
    setMarcados((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const sinAdmins = elegidos.filter((u) => u.role !== "admin");
  const yaTodos = sinAdmins.length > 0 && todosTienenLosOcho(sinAdmins);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) 2fr", gap: 16 }}>
      <div className="card" style={{ maxHeight: 520, overflow: "auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="btn" onClick={() => setMarcados(new Set(users.map((u) => u.id)))}>{t("All", "Todos")}</button>
          <button className="btn" onClick={() => setMarcados(new Set())}>{t("None", "Ninguno")}</button>
        </div>
        {[...users].sort((a, b) => a.full_name.localeCompare(b.full_name)).map((u) => (
          <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <input type="checkbox" checked={marcados.has(u.id)} onChange={() => toggle(u.id)} />
            {u.full_name} <span className="hint" style={{ color: colorDeRol(u.role) }}>· {roleLabel(u.role, lang)}</span>
          </label>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t("Selected", "Seleccionados")}: {elegidos.length}</h3>

        <h4>{t("Give the 8 manager modules", "Dar los 8 de gerente")}</h4>
        <p className="hint" style={{ marginTop: 0 }}>
          {MODULOS_DE_GERENTE.map((k) => etiquetaDeModulo(k, lang)).join(" · ")}
        </p>
        <button
          className="btn btn-primary"
          disabled={sinAdmins.length === 0 || yaTodos}
          onClick={() => aplicarPlan(planDarLosOcho(elegidos), t("Done: the 8 manager modules.", "Hecho: los 8 de gerente."))}
        >
          {yaTodos ? t("They already have the 8", "Ya tienen los 8") : t("Give the 8 to the selected", "Dar los 8 a los seleccionados")}
        </button>

        <hr style={{ margin: "16px 0" }} />

        <h4>{t("Turn one module on/off for the selected", "Activar o quitar un módulo a los seleccionados")}</h4>
        <select value={modulo} onChange={(e) => setModulo(e.target.value as ModuleAccessKey)} style={{ marginBottom: 10 }}>
          {MODULOS_DE_GERENTE.map((k) => (
            <option key={k} value={k}>{etiquetaDeModulo(k, lang)}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="btn" disabled={sinAdmins.length === 0} onClick={() => aplicarPlan(planToggleModulo(elegidos, modulo, true), t("Granted.", "Concedido."))}>
            ✅ {t("Grant", "Dar")}
          </button>
          <button className="btn" disabled={sinAdmins.length === 0} onClick={() => aplicarPlan(planToggleModulo(elegidos, modulo, false), t("Removed.", "Quitado."))}>
            🗑 {t("Remove", "Quitar")}
          </button>
        </div>
        <p className="hint">{t("Admins are never changed: they have every module through their role.", "A los administradores no se les toca: tienen todos los módulos por su rol.")}</p>
      </div>
    </div>
  );
}
