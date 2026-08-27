"use client";

import { useCallback, useEffect, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { MODULE_ACCESS, ROLE_INFO, roleLabel } from "@/lib/constants";
import type { ModuleAccessKey } from "@/lib/constants";
import { ClockinSettings } from "@/components/ClockinSettings";
import { avatarColor, initials } from "@/lib/utils";
import type { Profile, UserRole } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// ============================================================
// Everything about one person, in one place.
//
// All of this used to live on the row itself: two text boxes, three dropdowns,
// a permissions toggle, a password button and a delete button, repeated for
// every member of staff. Twenty-nine of them made a wall of controls where the
// only thing anyone was actually scanning for was a name.
//
// So the list went back to names and roles, and the configuring moved here,
// where there is room to say what each setting means.
// ============================================================

interface SignIn { email: string; synthetic: boolean; can_reset_own_password: boolean; last_sign_in_at: string | null }

export function UserDialog({ user: u, onClose }: { user: Profile; onClose: () => void }) {
  const { me, notify, settings, setUserIdentity, resetUserPassword, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, updateUserRecruitingAccess, updateUserTimetrackerAccess, updateUserErpAccess, updateUserDeliveriesAccess, updateUserClockinAccess, deleteUser, saveSettings } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();

  const [signIn, setSignIn] = useState<SignIn | null>(null);
  // Controlled, not defaultValue: signIn is fetched AFTER mount, and React
  // never refreshes an uncontrolled input. The email box showed blank for
  // everyone who had one, so "clearing" it was a no-op on something that
  // already looked cleared.
  const [emailDraft, setEmailDraft] = useState("");
  const [newPass, setNewPass] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The email lives in auth, not on the profile, so it has to be fetched -
  // and re-fetched after any change, or the dialog keeps showing the address
  // that was just replaced.
  const refreshSignIn = useCallback(async () => {
    if (LOCAL_MODE) return;
    try {
      const res = await fetch(`/api/user-identity?id=${encodeURIComponent(u.id)}`);
      if (res.ok) setSignIn((await res.json()) as SignIn);
    } catch { /* the rest of the dialog still works */ }
  }, [u.id]);

  useEffect(() => { void refreshSignIn(); }, [refreshSignIn]);
  useEffect(() => { setEmailDraft(signIn?.email ?? ""); }, [signIn]);

  if (!me) return null;
  const info = ROLE_INFO[u.role];
  const scoped = u.role === "manager" || u.role === "logistics";
  const storeScoped = u.role === "warehouse" || u.role === "driver" || u.role === "sales";

  // Explicit, exhaustive dispatch by module key (D-057) — never a single
  // generic "write the role" function shared across modules. ModuleAccessKey
  // is a closed union, so a module added to MODULE_ACCESS without a case
  // here fails `tsc`, not a silent write to the wrong profiles column at
  // runtime — the exact class of confusion (role vs recruiting_role) that
  // produced two of D-052's three bugs.
  const setModuleRole = (key: ModuleAccessKey, roleValue: string) => {
    switch (key) {
      case "deliveries": updateUserRole(u.id, roleValue as UserRole); return;
      case "recruiting": updateUserRecruitingAccess(u.id, { granted: true, recruiting_role: roleValue }); return;
      case "timetracker": updateUserTimetrackerAccess(u.id, { granted: true, timetracker_role: roleValue }); return;
      case "clockin": updateUserClockinAccess(u.id, { granted: true, clockin_role: roleValue }); return;
      case "erp":
        // No role tier of its own — the block renders a checkbox and nothing
        // to pick, so this is unreachable. Kept for exhaustiveness.
        return;
      default: { const _exhaustive: never = key; return _exhaustive; }
    }
  };
  const setModuleAccess = (key: ModuleAccessKey, granted: boolean) => {
    switch (key) {
      case "recruiting":
        updateUserRecruitingAccess(u.id, { granted, recruiting_role: granted ? (u.recruiting_role ?? "recruiter") : null });
        return;
      case "timetracker":
        updateUserTimetrackerAccess(u.id, { granted, timetracker_role: granted ? (u.timetracker_role ?? "employee") : null });
        return;
      case "clockin":
        updateUserClockinAccess(u.id, { granted, clockin_role: granted ? (u.clockin_role ?? "employee") : null });
        return;
      case "erp":
        updateUserErpAccess(u.id, { granted });
        return;
      case "deliveries":
        // Sí se llama desde D-100: Entregas dejó de ser implícita y su casilla ahora
        // es real. Quitarla NO borra `role` — ese es el rol dentro de entregas, y
        // conservarlo hace que devolver el acceso no obligue a recordar cuál era.
        updateUserDeliveriesAccess(u.id, { granted });
        return;
      default: { const _exhaustive: never = key; return _exhaustive; }
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span className="avatar" style={{ background: avatarColor(u.full_name || "?") }}>{initials(u.full_name || "?")}</span>
          <h3 style={{ margin: 0, flex: 1 }}>{u.full_name}</h3>
          <span className="sema" style={{ background: info.color, color: "#fff" }}>{roleLabel(u.role, lang)}</span>
        </div>
        <div className="hint" style={{ marginBottom: 14 }}>{lang === "es" ? info.desc_es : info.desc}</div>

        {/* ---------- Who they are ---------- */}
        <div className="section-label">{t("Identity", "Identidad")}</div>
        <div className="grid g2">
          <div className="field">
            <label>{t("Full name", "Nombre completo")}</label>
            <input
              defaultValue={u.full_name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== u.full_name && updateUserName(u.id, e.target.value.trim())}
            />
          </div>
          {!LOCAL_MODE && (
            <div className="field">
              <label>{t("Username", "Usuario")}</label>
              <input
                defaultValue={u.username ?? ""}
                placeholder={t("none — signs in with email", "ninguno — entra con correo")}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onBlur={async (e) => {
                  const v = e.target.value.trim().toLowerCase();
                  if (v === (u.username ?? "")) return;
                  await setUserIdentity(u.id, { username: v || null });
                  // A rename can move the sign-in address with it.
                  void refreshSignIn();
                }}
              />
            </div>
          )}
        </div>

        {!LOCAL_MODE && (
          <div className="field">
            <label>{t("Email", "Correo")}</label>
            <input
              type="email"
              value={emailDraft}
              onChange={(e) => setEmailDraft(e.target.value)}
              placeholder={signIn?.synthetic ? t("none on file", "ninguno registrado") : ""}
              onBlur={async (e) => {
                const v = e.target.value.trim().toLowerCase();
                if (v === (signIn?.email ?? "")) return;
                // Emptying the field means "sign in with the username from now
                // on". It used to be silently ignored, which looked exactly
                // like a save that failed.
                if (!v) {
                  if (!u.username) {
                    notify(t("Give them a username first - with no email they would have no way to sign in.",
                             "Ponle primero un usuario - sin correo no tendria forma de entrar."));
                    setEmailDraft(signIn?.email ?? "");
                    return;
                  }
                  const ok = await confirmAction(
                    t(`${u.full_name} will sign in as "${u.username}" and can no longer reset their own password. Remove the email?`,
                      `${u.full_name} entrara como "${u.username}" y ya no podra restablecer su propia contrasena. Quitar el correo?`),
                    { confirmLabel: t("Remove email", "Quitar correo") },
                  );
                  if (!ok) { setEmailDraft(signIn?.email ?? ""); return; }
                  await setUserIdentity(u.id, { email: null });
                } else {
                  await setUserIdentity(u.id, { email: v });
                }
                void refreshSignIn();
              }}
            />
            {/* Clearing the box works too, but a button is discoverable and
                says what it does. */}
            {signIn && !signIn.synthetic && u.username && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 6 }}
                onClick={async () => {
                  const ok = await confirmAction(
                    t(`${u.full_name} will sign in as "${u.username}" and can no longer reset their own password. Remove the email?`,
                      `${u.full_name} entrara como "${u.username}" y ya no podra restablecer su propia contrasena. Quitar el correo?`),
                    { confirmLabel: t("Remove email", "Quitar correo") },
                  );
                  if (!ok) return;
                  await setUserIdentity(u.id, { email: null });
                  void refreshSignIn();
                }}
              >{t(`Remove email — sign in as "${u.username}"`, `Quitar correo — entrar como "${u.username}"`)}</button>
            )}
            {/* Said here rather than discovered the day they forget. */}
            {signIn && !signIn.can_reset_own_password && (
              <div className="hint" style={{ color: "#b9791a", fontWeight: 600 }}>
                ⚠ {t(
                  "No email, so this account can never reset its own password — use the button below when they call.",
                  "Sin correo, así que esta cuenta nunca podrá restablecer su contraseña — usa el botón de abajo cuando te hablen.",
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------- Access, one block per module (D-057) ---------- */}
        {/* Recruiting's block has no local provider (D-050) — same gate the
            rest of the Supabase-only fields above already use. Deliveries'
            block still needs to render in local mode (it's the only module
            demo mode ever had), so the loop stays outside the !LOCAL_MODE
            check — each block decides for itself via its own alwaysOn/key. */}
        <div className="section-label">{t("Modules & permissions", "Módulos y permisos")}</div>
        {MODULE_ACCESS.filter((m) => m.alwaysOn || !LOCAL_MODE).map((m) => {
          // Generic lookup by roleColumn, not a hardcoded fallback to one
          // module's field — a third module here needed a real fix, not
          // another `: u.recruiting_role` clause (that bug would have shown
          // recruiting's role value inside every OTHER module's block).
          // A module with no roleColumn (the ERP) has no role to look up; its
          // access is the module_access flag alone.
          const currentRole = !m.roleColumn ? undefined
            : m.roleColumn === "role" ? u.role : (u[m.roleColumn] ?? undefined);
          // El acceso se lee de `module_access`, NO de si hay rol. Para los otros módulos
          // daba igual —su rol es nulo justo cuando no tienen acceso— pero el rol de
          // Entregas (`profiles.role`) es obligatorio y SIEMPRE tiene valor, así que
          // preguntar por él daba "otorgado" siempre: la casilla se volvía a marcar sola
          // y no había forma de quitársela a nadie.
          //
          // Los cinco módulos declaran `accessColumn`, y se comprobó que hoy no hay ni un
          // perfil donde el rol y el acceso discrepen, así que este cambio no mueve
          // ninguna casilla salvo la de Entregas.
          const granted = m.alwaysOn
            || (m.accessColumn ? !!u.module_access?.includes(m.key) : !!currentRole);
          // The lowest-listed role is the default when checking the box with
          // nothing chosen yet — matches what recruiting's own invite flow
          // always defaulted to ("recruiter", last in RECRUITING_ROLE_LABELS).
          const defaultRole = m.roleKeys[m.roleKeys.length - 1];

          return (
            <div key={m.key} className="card" style={{ marginBottom: 10 }}>
              {/* Same checkbox+label shape for every module — Deliveries'
                  is checked and disabled rather than hidden, so the blocks
                  read as one consistent pattern instead of "some modules
                  have a checkbox and some don't." It can't actually be
                  unchecked: profiles.role is NOT NULL, there's no "no
                  module" state to switch it to (D-057). */}
              <label
                className={"perm-opt" + (m.alwaysOn ? " locked" : "")}
                style={{ marginBottom: granted ? 10 : 0 }}
                title={m.alwaysOn ? t("Everyone has this", "Todos tienen esto") : undefined}
              >
                <input
                  type="checkbox"
                  checked={granted}
                  disabled={m.alwaysOn}
                  onChange={(e) => setModuleAccess(m.key, e.target.checked)}
                />
                <b>{lang === "es" ? m.label_es : m.label_en}</b>
                {m.alwaysOn && <span className="sema" style={{ background: "var(--gray)", color: "#fff", marginLeft: 6 }}>{t("everyone", "todos")}</span>}
              </label>

              {granted && (
                <div style={{ marginTop: 0 }}>
                  <div className="grid g2">
                    {/* A module with no role tier of its own (the ERP) rendered an
                        EMPTY <select> here, which reads as "the roles are missing"
                        rather than "this module has no roles". Say which dial
                        actually governs it instead. */}
                    {m.roleColumn ? (
                      <div className="field">
                        <label>{t("Role", "Rol")}</label>
                        <select
                          value={currentRole ?? defaultRole}
                          onChange={(e) => setModuleRole(m.key, e.target.value)}
                        >
                          {m.roleKeys.map((r) => <option key={r} value={r}>{m.roleLabel(r, lang)}</option>)}
                        </select>
                      </div>
                    ) : (
                      <div className="field">
                        <label>{t("Role", "Rol")}</label>
                        <div className="hint" style={{ marginTop: 4 }}>
                          {t(
                            "The ERP has no role of its own. Cost and margin are visible to Admin and Office Manager — set above, under Deliveries.",
                            "El ERP no tiene rol propio. El costo y el margen los ven Administrador y Gerente de Oficina — se define arriba, en Entregas."
                          )}
                        </div>
                      </div>
                    )}
                    {/* Deliveries-specific extras — not part of the generic
                        module shape, because no other module needs them and
                        they're tied to specific deliveries role values. */}
                    {m.key === "deliveries" && storeScoped && (
                      <div className="field">
                        <label>{t("Assigned store", "Tienda asignada")}</label>
                        <select value={u.store ?? ""} onChange={(e) => updateUserStore(u.id, e.target.value || null)}>
                          <option value="">{t("All stores", "Todas las tiendas")}</option>
                          {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                      </div>
                    )}
                    {m.key === "deliveries" && scoped && (
                      <div className="field">
                        <label>{t("Customer visibility", "Visibilidad de clientes")}</label>
                        <select
                          value={settings.customer_scope?.[u.id] ?? "all"}
                          onChange={(e) => saveSettings({ customer_scope: { ...(settings.customer_scope ?? {}), [u.id]: e.target.value as "all" | "own" } })}
                        >
                          <option value="all">{t("All customers", "Todos los clientes")}</option>
                          <option value="own">{t("Own customers only", "Solo sus clientes")}</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Clock-in's crew settings, which used to be a screen of their own inside the
                      module (D-095). Everything here is per-person configuration of somebody
                      else, which is what this dialog is for — the module keeps only what a
                      person does with their own time, plus the vehicle list, which is about
                      trucks rather than people. */}
                  {m.key === "clockin" && !LOCAL_MODE && (
                    <ClockinSettings userId={u.id} clockinRole={u.clockin_role ?? null} />
                  )}

                  {/* Fine-grained extras — only drawn when this module's
                      descriptor actually has a catalog (today: deliveries
                      only). Absent for recruiting on purpose: it has no
                      per-permission concept, just the role tier above. */}
                  {m.capabilities && (
                    <>
                      <div className="hint" style={{ margin: "10px 0 8px" }}>
                        {t(
                          `On top of what the ${m.roleLabel(currentRole ?? defaultRole, lang)} role already allows. The role's own are locked on.`,
                          `Además de lo que el rol ${m.roleLabel(currentRole ?? defaultRole, lang)} ya permite. Los del rol están fijos.`,
                        )}
                      </div>
                      <div className="grid g2">
                        {m.capabilities.map((c) => {
                          const fromRole = m.capabilitiesFromRole?.(currentRole ?? defaultRole).includes(c.key) ?? false;
                          const capGranted = fromRole || !!u.permissions?.includes(c.key);
                          return (
                            <label key={c.key} className={"perm-opt " + (fromRole ? "locked" : "")}>
                              <input
                                type="checkbox"
                                checked={capGranted}
                                disabled={fromRole}
                                onChange={(e) => {
                                  const cur = (u.permissions ?? []).filter((p) => p !== c.key);
                                  updateUserPermissions(u.id, e.target.checked ? [...cur, c.key] : cur);
                                }}
                              />
                              <span>
                                <b>{lang === "es" ? c.es : c.en}</b>
                                {fromRole && <span className="sema" style={{ background: "var(--gray)", color: "#fff", marginLeft: 6 }}>{t("from role", "del rol")}</span>}
                                <span className="hint" style={{ display: "block" }}>{lang === "es" ? c.desc_es : c.desc_en}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ---------- Access ---------- */}
        {!LOCAL_MODE && (
          <>
            <div className="section-label">{t("Access", "Acceso")}</div>
            {newPass ? (
              <div className="card" style={{ margin: 0, background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
                <div className="detail-row">
                  <span className="dk">{t("New password", "Contraseña nueva")}</span>
                  <span className="dv" style={{ fontFamily: "monospace", fontSize: 17 }}>{newPass}</span>
                </div>
                <div className="hint">
                  {t("Shown once. Their old password stopped working when you pressed the button.",
                     "Se muestra una sola vez. La anterior dejó de servir al presionar el botón.")}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                  onClick={() => navigator.clipboard?.writeText(newPass)}>📋 {t("Copy", "Copiar")}</button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={async () => {
                  if (!(await confirmAction(
                    t(`Give ${u.full_name} a new password? Their current one stops working immediately.`,
                      `¿Dar a ${u.full_name} una contraseña nueva? La actual deja de servir de inmediato.`),
                    { confirmLabel: t("New password", "Nueva contraseña") },
                  ))) return;
                  setBusy(true);
                  const res = await resetUserPassword(u.id);
                  setBusy(false);
                  if (res.ok && res.password) setNewPass(res.password);
                }}
              >🔒 {t("Set a new password", "Poner contraseña nueva")}</button>
            )}
            {signIn?.last_sign_in_at && (
              <div className="hint" style={{ marginTop: 6 }}>
                {t("Last signed in", "Último acceso")}: {new Date(signIn.last_sign_in_at).toLocaleString(lang === "es" ? "es-MX" : "en-US")}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={onClose}>{t("Done", "Listo")}</button>
          <span style={{ flex: 1 }} />
          {/* An admin can't delete themselves out of the only admin account. */}
          {u.id !== me.id && (
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (await confirmAction(
                t(`Remove ${u.full_name}? This deletes their login.`, `¿Eliminar a ${u.full_name}? Esto borra su acceso.`),
                { danger: true, confirmLabel: t("Remove", "Eliminar") },
              )) { await deleteUser(u.id); onClose(); }
            }}>{t("Remove", "Eliminar")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
