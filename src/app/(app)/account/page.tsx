"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { CAPABILITIES, ROLE_INFO, extraCaps, permissionsFor, personBadge } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";

// ============================================================
// "My Account" — every signed-in user gets this, whatever their role.
// Shows who they are, what they're allowed to do, and their personal
// preferences. A summary of their own work lives on the Summary tab.
// ============================================================

export default function AccountPage() {
  const { me, settings, users, updateUserName, notify, teaching, setTeaching, clearTrainingData } = useData();
  const { lang, theme, setLang, setTheme, t } = usePrefs();
  const [name, setName] = useState(me?.full_name ?? "");
  const [saving, setSaving] = useState(false);

  if (!me) return null;
  const role = ROLE_INFO[me.role];
  // La pastilla puede llevar el título que le haya puesto un admin (D-252); la frase
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

      {/* ---------- Tutorials ----------
          Se mudaron al hub (D-NEXT): son de todas las apps, y los ve también quien no tiene
          Entregas. Aquí queda el camino, que es el del chofer, porque no entra al lobby (D-173). */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>🎬 {t("Tutorials", "Tutoriales")}</h2>
        <Link href="/home/tutorials" className="btn btn-primary">
          {t("🎬 Tutorials → hub", "🎬 Tutoriales → hub")}
        </Link>
      </div>

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
        {/* La contraseña es una sola para todas las apps, y se cambia en un solo sitio: «Mi
            perfil», en el hub (D-265). El chofer también llega por aquí: su puerta es de sesión,
            no del lobby. */}
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Your password is the same for every app, and it's changed in one place.",
            "Tu contraseña es la misma para todas las apps, y se cambia en un solo sitio.",
          )}
        </p>
        <Link href="/home/profile" className="btn btn-primary">
          {t("Change password → My profile (hub)", "Cambiar contraseña → Mi perfil (hub)")}
        </Link>
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
