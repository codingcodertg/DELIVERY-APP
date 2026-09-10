"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { CAPABILITIES, ROLE_INFO, extraCaps, permissionsFor, personBadge } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";
import { tutorialEmbed } from "@/lib/tutorials";
import type { Profile, Settings, Tutorial } from "@/lib/types";

// ============================================================
// "My Account" — every signed-in user gets this, whatever their role.
// Shows who they are, what they're allowed to do, and their personal
// preferences. A summary of their own work lives on the Summary tab.
// ============================================================

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default function AccountPage() {
  const { me, settings, users, updateUserName, notify, teaching, setTeaching, clearTrainingData, saveSettings } = useData();
  const { lang, theme, setLang, setTheme, t } = usePrefs();
  const [name, setName] = useState(me?.full_name ?? "");
  const [saving, setSaving] = useState(false);

  if (!me) return null;
  const role = ROLE_INFO[me.role];
  // La pastilla puede llevar el título que le haya puesto un admin (D-NEXT); la frase
  // de debajo sigue saliendo del rol, porque describe lo que esta persona puede hacer.
  const badge = personBadge(me, lang);

  const clearTraining = async () => {
    if (confirm(t("Discard all practice changes and reset the sandbox to the current real data?",
                  "¿Descartar todos los cambios de práctica y reiniciar el entorno con los datos reales actuales?"))) {
      await clearTrainingData();
    }
  };

  const saveName = async () => {
    const v = name.trim();
    if (!v || v === me.full_name) return;
    setSaving(true);
    await updateUserName(me.id, v);
    setSaving(false);
    notify(t("Name updated", "Nombre actualizado"));
  };

  return (
    <>
      <div className="page-head"><h2>{t("My account", "Mi cuenta")}</h2></div>

      {/* ---------- Identity ---------- */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span className="avatar" style={{ background: avatarColor(me.full_name || "?"), width: 60, height: 60, flex: "0 0 60px", fontSize: 22 }}>
            {initials(me.full_name || "?")}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Archivo, sans-serif", fontSize: 22, fontWeight: 800 }}>{me.full_name}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
              <span className="sema" style={{ background: badge.color, color: "#fff" }}>{badge.text}</span>
              {me.store && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>🏬 {me.store}</span>}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{lang === "es" ? role.desc_es : role.desc}</div>
          </div>
        </div>
      </div>

      {/* ---------- Tutorials (everyone watches; admin manages) ---------- */}
      <TutorialsSection
        tutorials={settings.tutorials ?? []}
        canManage={me.role === "admin"}
        me={me}
        saveSettings={saveSettings}
        notify={notify}
        t={t}
      />

      {/* ---------- Settings entry point (admin only — everyone else's options
           live right here in the account view). ---------- */}
      {me.role === "admin" && (
        <div className="card">
          <h2>⚙️ {t("Settings", "Ajustes")}</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            {t("Workspace configuration, stores, and app options.", "Configuración del espacio, tiendas y opciones de la app.")}
          </p>
          <Link href="/settings" className="btn btn-primary" style={{ textDecoration: "none" }}>
            ⚙️ {t("Open settings", "Abrir ajustes")}
          </Link>
        </div>
      )}

      {/* ---------- Teaching / practice mode (everyone) ---------- */}
      <div className="card">
        <h2>🎓 {t("Teaching / practice mode", "Modo enseñanza / práctica")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "A private practice sandbox on top of the real orders. Create, edit or delete anything you like — none of it is saved to the database or seen by anyone else, and it all disappears the moment you turn teaching off. Meanwhile real changes other people make still flow in live underneath, so you always practice against the current data.",
            "Un entorno de práctica privado sobre las órdenes reales. Crea, edita o elimina lo que quieras — nada se guarda en la base de datos ni lo ve nadie más, y todo desaparece en cuanto desactivas el modo enseñanza. Mientras tanto, los cambios reales de otras personas siguen llegando en vivo por debajo, así que siempre practicas con los datos actuales.",
          )}
        </p>
        <div className="toggle-group">
          <button className={"toggle-btn " + (!teaching ? "on" : "")} onClick={() => setTeaching(false)}>{t("Live", "Real")}</button>
          <button className={"toggle-btn " + (teaching ? "on" : "")} onClick={() => setTeaching(true)}
            style={teaching ? { background: "#7c3aed", borderColor: "#7c3aed" } : undefined}>
            🎓 {t("Teaching", "Enseñanza")}
          </button>
        </div>
        {teaching && <div className="hint" style={{ color: "var(--teaching-text)", fontWeight: 700 }}>{t("Teaching mode is ON — you are working with practice orders.", "El modo enseñanza está ACTIVO — estás trabajando con órdenes de práctica.")}</div>}
        {teaching && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <button className="btn btn-danger btn-sm" onClick={clearTraining}>🗑 {t("Reset sandbox", "Reiniciar práctica")}</button>
            <div className="hint">{t("Throws away your practice changes and starts fresh from the current real data. Nothing real is affected.", "Descarta tus cambios de práctica y empieza de nuevo con los datos reales actuales. Nada real se ve afectado.")}</div>
          </div>
        )}
      </div>

      {/* ---------- Profile + preferences ---------- */}
      <div className="card">
        <h2>👤 {t("Profile", "Perfil")}</h2>
        <div className="grid g2" style={{ maxWidth: 520 }}>
          <div className="field">
            <label>{t("Display name", "Nombre visible")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-primary" onClick={saveName} disabled={saving || !name.trim() || name.trim() === me.full_name}>
                {t("Save", "Guardar")}
              </button>
            </div>
          </div>
          <div className="field">
            <label>{t("Store", "Tienda")}</label>
            <input value={me.store || t("All stores", "Todas las tiendas")} disabled />
            <div className="hint">{t("Only an admin can change your store.", "Solo un administrador puede cambiar su tienda.")}</div>
          </div>
        </div>

        <div className="grid g2" style={{ maxWidth: 520 }}>
          <div className="field">
            <label>{t("Language", "Idioma")}</label>
            <div className="toggle-group">
              <button className={"toggle-btn " + (lang === "en" ? "on" : "")} onClick={() => setLang("en")}>🇬🇧 English</button>
              <button className={"toggle-btn " + (lang === "es" ? "on" : "")} onClick={() => setLang("es")}>🇪🇸 Español</button>
            </div>
          </div>
          <div className="field">
            <label>{t("Theme", "Tema")}</label>
            <div className="toggle-group">
              <button className={"toggle-btn " + (theme === "light" ? "on" : "")} onClick={() => setTheme("light")}>☀️ {t("Light", "Claro")}</button>
              <button className={"toggle-btn " + (theme === "dark" ? "on" : "")} onClick={() => setTheme("dark")}>🌙 {t("Dark", "Oscuro")}</button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Change password ---------- */}
      <div className="card">
        <h2>🔒 {t("Change password", "Cambiar contraseña")}</h2>
        {LOCAL_MODE ? (
          <p className="hint" style={{ marginTop: 0 }}>
            {t(
              "Not available in local demo mode — there's no real account here, so no password to change.",
              "No disponible en modo demo local — no hay una cuenta real aquí, así que no hay contraseña que cambiar.",
            )}
          </p>
        ) : (
          <ChangePassword t={t} />
        )}
      </div>

      {/* ---------- What I can do ---------- */}
      <div className="card">
        <h2>🔑 {t("What I can do", "Lo que puedo hacer")}</h2>
        <div className="pill-list">
          {permissionsFor(me.role, lang, settings.role_permissions).map((p) => (
            <span key={p} className="pill-item">✓ {p}</span>
          ))}
          {/* Capabilities an admin granted to this person specifically. */}
          {extraCaps(me).map((c) => {
            const info = CAPABILITIES.find((x) => x.key === c);
            return (
              <span key={c} className="pill-item" style={{ borderColor: "var(--amber)", background: "var(--amber-soft)" }}>
                ★ {info ? (lang === "es" ? info.es : info.en) : c}
              </span>
            );
          })}
        </div>
        {extraCaps(me).length > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            ★ {t("Granted to you specifically by an admin.", "Otorgado a usted específicamente por un administrador.")}
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          {t("Workspace", "Espacio")}: <b>{settings.app_name}</b> · {t("Team", "Equipo")}: {users.length} {t("people", "personas")}
        </div>
      </div>
    </>
  );
}

/** Account-view "Tutorials" zone: a list of how-to videos embedded from their
 * links. Everyone watches; an admin adds/removes them. */
function TutorialsSection({ tutorials, canManage, me, saveSettings, notify, t }: {
  tutorials: Tutorial[];
  canManage: boolean;
  me: Profile;
  saveSettings: (patch: Partial<Settings>) => void;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");

  const reset = () => { setTitle(""); setUrl(""); setDesc(""); setAdding(false); };
  const add = () => {
    if (!title.trim() || !url.trim()) return;
    const item: Tutorial = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: title.trim(), description: desc.trim() || null, url: url.trim(),
      added_by: me.id, added_at: new Date().toISOString(),
    };
    saveSettings({ tutorials: [...tutorials, item] });
    reset();
    notify(t("Tutorial added", "Tutorial agregado"));
  };
  const remove = (id: string) => {
    if (!confirm(t("Remove this tutorial?", "¿Eliminar este tutorial?"))) return;
    saveSettings({ tutorials: tutorials.filter((x) => x.id !== id) });
    notify(t("Tutorial removed", "Tutorial eliminado"));
  };

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>🎬 {t("Tutorials", "Tutoriales")}</h2>
        {canManage && !adding && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>＋ {t("Add tutorial", "Agregar tutorial")}</button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 6, marginBottom: 12 }}>
        {t("Short how-to videos for using the app.", "Videos cortos de cómo usar la app.")}
      </p>

      {canManage && adding && (
        <div className="card" style={{ padding: 12, marginBottom: 16 }}>
          <div className="field">
            <label>{t("Title", "Título")}</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. How to create an order", "ej. Cómo crear una orden")} />
          </div>
          <div className="field">
            <label>{t("Video link (YouTube, Loom, Vimeo, Drive)", "Enlace del video (YouTube, Loom, Vimeo, Drive)")}</label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="field">
            <label>{t("Description (optional)", "Descripción (opcional)")}</label>
            <textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost btn-sm" onClick={reset}>{t("Cancel", "Cancelar")}</button>
            <button className="btn btn-primary btn-sm" onClick={add} disabled={!title.trim() || !url.trim()}>{t("Add", "Agregar")}</button>
          </div>
        </div>
      )}

      {tutorials.length === 0 ? (
        <div className="hint">{t("No tutorials yet.", "Aún no hay tutoriales.")}</div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {tutorials.map((tut) => {
            const em = tutorialEmbed(tut.url);
            return (
              <div key={tut.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <b style={{ fontFamily: "Archivo, sans-serif", fontSize: 16 }}>{tut.title}</b>
                  {canManage && (
                    <button className="btn btn-ghost btn-sm" title={t("Remove", "Quitar")} onClick={() => remove(tut.id)}>✕</button>
                  )}
                </div>
                {tut.description && <div className="hint" style={{ marginTop: 2 }}>{tut.description}</div>}
                <div style={{ marginTop: 8 }}>
                  {em.kind === "iframe" ? (
                    <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 10, overflow: "hidden", background: "#000" }}>
                      <iframe
                        src={em.src}
                        title={tut.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                      />
                    </div>
                  ) : em.kind === "file" ? (
                    <video src={em.src} controls style={{ width: "100%", borderRadius: 10, background: "#000" }} />
                  ) : (
                    <a className="btn btn-ghost btn-sm" href={em.src} target="_blank" rel="noopener noreferrer">▶ {t("Open video", "Abrir video")}</a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Self-service password change — verifies the current password before
 * setting the new one, same as any account-security page should. */
function ChangePassword({ t }: { t: (en: string, es: string) => string }) {
  const supabase = createClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    setMsg(null);
    if (next.length < 6) {
      setMsg({ text: t("New password must be at least 6 characters.", "La nueva contraseña debe tener al menos 6 caracteres."), ok: false });
      return;
    }
    if (next !== confirm) {
      setMsg({ text: t("New passwords don't match.", "Las contraseñas nuevas no coinciden."), ok: false });
      return;
    }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error(t("Could not verify your account.", "No se pudo verificar su cuenta."));
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (verifyErr) throw new Error(t("Current password is incorrect.", "La contraseña actual es incorrecta."));
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setMsg({ text: t("Password updated.", "Contraseña actualizada."), ok: true });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid g2" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>{t("Current password", "Contraseña actual")}</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <div />
        <div className="field">
          <label>{t("New password", "Nueva contraseña")}</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </div>
        <div className="field">
          <label>{t("Confirm new password", "Confirmar nueva contraseña")}</label>
          <input
            type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••" autoComplete="new-password"
          />
        </div>
      </div>
      <button className="btn btn-primary" onClick={submit} disabled={busy || !current || !next || !confirm}>
        {busy ? "…" : t("Update password", "Actualizar contraseña")}
      </button>
      {msg && <div className="hint" style={{ marginTop: 10, color: msg.ok ? "var(--green)" : "var(--red)" }}>{msg.text}</div>}
    </>
  );
}

