"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { UserDialog } from "@/components/UserDialog";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { ROLE_INFO, ROLE_ORDER, extraCaps, roleLabel } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";
import { UsersImportModal } from "@/components/UsersImportModal";
import type { Profile, UserRole } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// Moved from (app)/users/page.tsx to the hub (D-056) — same screen, same
// UserDialog, same data-provider functions, only the address changed. The
// admin-only gate that used to live here (a client-side "Admins only"
// message) is gone: home/users/layout.tsx now redirects a non-admin before
// this component ever mounts, so there's nothing left to check here.
export default function UsersPage() {
  const { me, users, settings, addUser } = useData();
  const { lang, t } = usePrefs();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("sales");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ signInWith: string; password: string; canReset: boolean } | null>(null);
  // The person being configured, if any.
  const [editing, setEditing] = useState<Profile | null>(null);
  const [bulk, setBulk] = useState(false);
  const [groupByStore, setGroupByStore] = useState(true);

  // Team grouped by assigned store, in the settings store order, with a final
  // bucket for users with no store (admin / logistics / office). Within a group,
  // sorted by role then name.
  const groups = useMemo(() => {
    const NO_STORE = "__none__";
    const byStore = new Map<string, Profile[]>();
    for (const u of users) {
      const key = u.store || NO_STORE;
      (byStore.get(key) ?? byStore.set(key, []).get(key)!).push(u);
    }
    const out: { key: string; label: string; list: Profile[] }[] = [];
    for (const s of settings.stores) if (byStore.has(s.name)) out.push({ key: s.name, label: s.name, list: byStore.get(s.name)! });
    for (const [k, list] of byStore) if (k !== NO_STORE && !settings.stores.some((s) => s.name === k)) out.push({ key: k, label: k, list });
    if (byStore.has(NO_STORE)) out.push({ key: NO_STORE, label: t("No store (Admin / Office / Logistics)", "Sin tienda (Admin / Oficina / Logística)"), list: byStore.get(NO_STORE)! });
    for (const g of out) g.list.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.full_name || "").localeCompare(b.full_name || ""));
    return out;
  }, [users, settings.stores, t]);

  if (!me) return null;

  const submit = async () => {
    setBusy(true);
    const res = await addUser({
      email: email.trim() || undefined,
      username: username.trim() || undefined,
      full_name: name, role, password: password.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) {
      if (!LOCAL_MODE && res.password) {
        setCreated({
          // What they should TYPE. For a username account the derived address
          // is an implementation detail nobody should have to know or repeat.
          signInWith: res.signInWith || res.email || "",
          password: res.password,
          canReset: res.can_reset_own_password !== false,
        });
      }
      setEmail(""); setName(""); setRole("sales"); setPassword("");
    }
  };

  // Name and role. Nothing else.
  //
  // Every control that used to live here now lives in the dialog: with
  // twenty-nine people on the list, a row carrying two text boxes and three
  // dropdowns turned the one thing anyone scans for — a name — into the
  // smallest item on the line.
  const renderRow = (u: Profile) => {
    const info = ROLE_INFO[u.role];
    const extra = extraCaps(u);
    return (
      <button
        key={u.id}
        className="user-row user-row-click"
        onClick={() => setEditing(u)}
        title={t("Open and configure", "Abrir y configurar")}
      >
        <span className="avatar" style={{ background: avatarColor(u.full_name || "?") }}>{initials(u.full_name || "?")}</span>
        <span style={{ flex: 1, minWidth: 0, fontWeight: 700, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>
          {u.full_name}
          {u.username && <span className="hint" style={{ marginLeft: 8, fontWeight: 500 }}>@{u.username}</span>}
        </span>
        {/* A quiet marker that this person was given something beyond their
            role — otherwise the only way to know is to open all of them. */}
        {extra.length > 0 && (
          <span className="sema" style={{ background: "var(--amber)", color: "#fff" }} title={t("Extra permissions", "Permisos extra")}>
            🔑 +{extra.length}
          </span>
        )}
        {/* Cross-module access (D-053) is worth surfacing here for the same
            reason the extra-permissions marker is: otherwise the only way to
            know is opening all twenty-nine dialogs one by one. */}
        {u.recruiting_role && (
          <span className="sema" style={{ background: "var(--purple)", color: "#fff" }} title={t("Has Recruiting access", "Tiene acceso a Recruiting")}>
            🧑‍💼 Recruiting
          </span>
        )}
        <span className="sema" style={{ background: info.color, color: "#fff" }}>{roleLabel(u.role, lang)}</span>
        <span className="hint" style={{ marginTop: 0 }}>›</span>
      </button>
    );
  };

  // Either identifier will do. Requiring an email was what forced the office
  // to invent addresses for warehouse staff and drivers who don't have one.
  const canSubmit = LOCAL_MODE ? !!name.trim() : (!!email.trim() || !!username.trim());

  return (
    <>
      <Link href="/home" className="hint" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 10, textDecoration: "none" }}>
        ← {t("Back to hub", "Volver al hub")}
      </Link>

      <div className="page-head">
        <h2>{t("Users", "Usuarios")}</h2>
        {!LOCAL_MODE && <button className="btn btn-ghost" onClick={() => setBulk(true)}>⬆ {t("Bulk import", "Importar en lote")}</button>}
      </div>

      <div className="card">
        <h2>{t("Create a user", "Crear un usuario")}</h2>
        <div className="grid g4">
          <div className="field"><label>{t("Full name", "Nombre completo")}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></div>
          <div className="field">
            <label>{t("Email", "Correo")} {t("(or username below)", "(o usuario abajo)")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
          </div>
          <div className="field">
            <label>{t("Username", "Usuario")}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="maximo"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>{t("Role", "Rol")}</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
            </select>
          </div>
          {!LOCAL_MODE && (
            <div className="field">
              <label>{t("Password", "Contraseña")}</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auto-generate if blank", "auto si vacío")} />
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !canSubmit}>
          {t("Create user", "Crear usuario")}
        </button>
        <div className="hint">
          {LOCAL_MODE
            ? t("In local demo mode users are created instantly in this browser. Switch to any of them from the yellow “View as” bar at the top.", "En modo demo local los usuarios se crean al instante en este navegador. Cámbialos desde la barra amarilla “Ver como” arriba.")
            : t("The account is created active — no email confirmation needed. Give the person their email + password below and they can sign in right away.", "La cuenta se crea activa — sin confirmación por correo. Entrega a la persona su correo + contraseña de abajo y podrá iniciar sesión de inmediato.")}
        </div>

        {created && (
          <div className="card" style={{ marginTop: 14, marginBottom: 0, background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
            <b>{t("Account ready — share these credentials", "Cuenta lista — comparte estas credenciales")}</b>
            <div className="detail-row"><span className="dk">{t("Sign in with", "Entrar con")}</span><span className="dv">{created.signInWith}</span></div>
            <div className="detail-row"><span className="dk">{t("Password", "Contraseña")}</span><span className="dv" style={{ fontFamily: "monospace", fontSize: 15 }}>{created.password}</span></div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(`${created.signInWith} / ${created.password}`)}>
                📋 {t("Copy", "Copiar")}
              </button>
              <button className="btn btn-sm" onClick={() => setCreated(null)}>{t("Dismiss", "Cerrar")}</button>
            </div>
            <div className="hint">{t("This password is shown only once. The user can change it later.", "Esta contraseña se muestra solo una vez. El usuario puede cambiarla después.")}</div>
            {/* Said at the moment of creation, not discovered the day they
                forget it. A derived address receives no mail, so no reset link
                can ever reach them. */}
            {!created.canReset && (
              <div className="hint" style={{ color: "#b9791a", fontWeight: 600, marginTop: 6 }}>
                ⚠ {t(
                  "This account has no email, so it can never reset its own password — an admin has to set a new one.",
                  "Esta cuenta no tiene correo, así que nunca podrá restablecer su propia contraseña — un admin tendrá que ponerle una nueva.",
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{t("Team", "Equipo")} ({users.length})</h2>
          <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={groupByStore} onChange={(e) => setGroupByStore(e.target.checked)} style={{ width: "auto" }} />
            {t("Group by store", "Agrupar por tienda")}
          </label>
        </div>
        {groupByStore
          ? groups.map((g) => (
              <div key={g.key} style={{ marginBottom: 16 }}>
                <div className="section-label" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  🏬 {g.label} <span className="count-tag">{g.list.length}</span>
                </div>
                {g.list.map(renderRow)}
              </div>
            ))
          : users.map(renderRow)}
      </div>

      {bulk && <UsersImportModal onClose={() => setBulk(false)} />}

      {/* Everything about one person, opened from the list. Re-read from
          `users` on each render so an edit shows immediately. */}
      {editing && (
        <UserDialog
          user={users.find((x) => x.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
