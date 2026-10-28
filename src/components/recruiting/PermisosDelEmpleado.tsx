"use client";

import { useState } from "react";
import { ConfirmProvider } from "@/lib/confirm";
import { DataProvider as ProveedorDelHub, useData as useHub } from "@/lib/data-provider";
import { UserDialog } from "@/components/UserDialog";
import { usePrefs } from "@/lib/prefs";
import { ROLE_ORDER, roleLabel } from "@/lib/constants";
import { precargaDeEmpleado } from "@/lib/recruiting/usuarios-rrhh";
import type { Profile, UserRole } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type Persona = { id: string; profile_id: string | null; full_name: string | null; email?: string | null; personal_email?: string | null; store?: string | null };

/**
 * «Permisos» del expediente (D-720). El dueño: «cuando uno se mete al perfil del empleado, va a haber un botón en la
 * parte de arriba que va a decir permisos. Y el permiso ahí no se va a llevar a otra window. Va a ser abrir una window
 * donde van a estar todos los permisos y uno ahí le da los permisos a la persona».
 *
 * Es la misma ventana del hub (`UserDialog`: rol, tienda, apps, permisos extra, contraseña), que vive del proveedor de
 * datos DEL HUB. Ese proveedor se monta AQUÍ, solo mientras la ventana está abierta, y no en todo /recruiting: D-693 y
 * D-695 lo intentaron para la página «Crear usuarios» y Vercel murió por memoria. Con cuenta, se abre el diálogo; sin
 * cuenta, un alta corta que crea la cuenta (`addUser`, el mismo /api/invite de Usuarios), la enlaza al expediente por
 * /api/recruiting/usuario-de-empleado (D-702) y enseña las credenciales una vez, como Usuarios.
 */
export function PermisosDelEmpleado({ persona, hub, onClose, onEnlazado }: {
  persona: Persona;
  /** El perfil DEL HUB de quien abre (role = el de Entregas). Solo un admin llega aquí; el servidor lo vuelve a exigir. */
  hub: Profile;
  onClose: () => void;
  /** Se creó o cambió la cuenta: el expediente se vuelve a leer. */
  onEnlazado: () => void;
}) {
  return (
    <ConfirmProvider>
      <ProveedorDelHub me={hub}>
        <Cuerpo persona={persona} onClose={onClose} onEnlazado={onEnlazado} />
      </ProveedorDelHub>
    </ConfirmProvider>
  );
}

function Cuerpo({ persona, onClose, onEnlazado }: { persona: Persona; onClose: () => void; onEnlazado: () => void }) {
  const { ready, users, settings, addUser, notify } = useHub();
  const { t, lang } = usePrefs();
  const pre = precargaDeEmpleado(persona);
  const [profileId, setProfileId] = useState(persona.profile_id);
  const [name, setName] = useState(pre.full_name);
  const [email, setEmail] = useState(pre.email);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<UserRole>("sales");
  const [store, setStore] = useState(pre.store ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Las credenciales recién creadas: se enseñan UNA vez, antes de pasar a los permisos.
  const [creado, setCreado] = useState<{ signInWith: string; password: string; canReset: boolean } | null>(null);
  const usuario = profileId ? users.find((u) => u.id === profileId) ?? null : null;
  const cerrar = () => { onEnlazado(); onClose(); };

  async function crea() {
    setBusy(true);
    const res = await addUser({
      email: email.trim() || undefined,
      username: username.trim() || undefined,
      full_name: name.trim(), role, password: password.trim() || undefined,
      ...(store ? { store } : {}),
    });
    if (!res.ok) { setBusy(false); notify("Error: " + (res.error ?? "")); return; }
    // El enlace con el expediente va por /api, no con `actions/hr` (tumbaba el build: D-702).
    if (!res.id) {
      notify(t("User created, but its id did not come back: link the employee file by hand.", "Usuario creado, pero no volvió su id: enlaza el expediente a mano."));
    } else {
      const r = await fetch("/api/recruiting/usuario-de-empleado", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId: persona.id, profileId: res.id }) });
      const b = await r.json().catch(() => ({}));
      notify(r.ok
        ? t("User created and linked to the employee ✓", "Usuario creado y enlazado al empleado ✓")
        : t("User created, but linking the employee file failed: ", "Usuario creado, pero falló el enlace con el expediente: ") + ((b as { error?: string }).error ?? ""));
      setProfileId(res.id);
    }
    setBusy(false);
    onEnlazado();
    if (!LOCAL_MODE && res.password) {
      setCreado({ signInWith: res.signInWith || res.email || "", password: res.password, canReset: res.can_reset_own_password !== false });
    }
  }

  // 1. Con cuenta: la ventana del hub tal cual.
  if (profileId && !creado) {
    if (usuario) return <UserDialog user={usuario} onClose={cerrar} />;
    return (
      <div className="overlay" onClick={cerrar}>
        <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()} data-dialogo="permisos-cargando">
          <div className="hint" style={{ marginTop: 0 }}>
            {ready
              ? t("This account could not be found among the hub users.", "No se encontró esta cuenta entre los usuarios del hub.")
              : t("Loading the account…", "Cargando la cuenta…")}
          </div>
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={cerrar}>{t("Close", "Cerrar")}</button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Recién creada: las credenciales, una vez, y de ahí a los permisos.
  if (creado) {
    return (
      <div className="overlay" onClick={(e) => e.stopPropagation()}>
        <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} data-dialogo="credenciales">
          <b>{t("Account ready — share these credentials", "Cuenta lista — comparte estas credenciales")}</b>
          <div className="detail-row"><span className="dk">{t("Sign in with", "Entrar con")}</span><span className="dv">{creado.signInWith}</span></div>
          <div className="detail-row"><span className="dk">{t("Password", "Contraseña")}</span><span className="dv" style={{ fontFamily: "monospace", fontSize: 15 }}>{creado.password}</span></div>
          <div className="hint">{t("This password is shown only once. The user can change it later.", "Esta contraseña se muestra solo una vez. El usuario puede cambiarla después.")}</div>
          {!creado.canReset && (
            <div className="hint" style={{ color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>
              ⚠ {t("This account has no email, so it can never reset its own password — an admin has to set a new one.",
                   "Esta cuenta no tiene correo, así que nunca podrá restablecer su propia contraseña — un admin tendrá que ponerle una nueva.")}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(`${creado.signInWith} / ${creado.password}`)}>
              📋 {t("Copy", "Copiar")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={cerrar}>{t("Close", "Cerrar")}</button>
            <button className="btn btn-sm btn-primary" data-accion="a-permisos" onClick={() => setCreado(null)}>
              🔑 {t("Permissions →", "Permisos →")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. Sin cuenta: el alta corta, precargada con el expediente.
  const puedeCrear = LOCAL_MODE ? !!name.trim() : !!name.trim() && (!!email.trim() || !!username.trim());
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()} data-dialogo="crear-cuenta">
        <h3 style={{ margin: 0 }}>🔑 {t("Create hub account", "Crear cuenta del hub")} — {persona.full_name}</h3>
        <p className="hint" style={{ marginTop: 6 }}>
          {t("No hub account yet. Create it here; role, store and apps are set right after.",
             "Todavía no tiene cuenta del hub. Créala aquí; el rol, la tienda y las apps se ajustan justo después.")}
        </p>
        <div className="grid g2" style={{ marginTop: 12 }}>
          <div><label>{t("Full name", "Nombre completo")}</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label>{t("Email", "Correo")} {t("(or username)", "(o usuario)")}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" /></div>
          <div><label>{t("Username", "Usuario")}</label><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></div>
          <div>
            <label>{t("Role", "Rol")}</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
            </select>
          </div>
          <div>
            <label>{t("Store", "Tienda")}</label>
            <select value={store} onChange={(e) => setStore(e.target.value)}>
              <option value="">{t("— none —", "— sin tienda —")}</option>
              {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              {store && !settings.stores.some((s) => s.name === store) && <option value={store}>{store}</option>}
            </select>
          </div>
          {!LOCAL_MODE && (
            <div><label>{t("Password", "Contraseña")}</label><input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auto-generate if blank", "auto si vacío")} /></div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button className="btn btn-ghost" onClick={onClose}>{t("Cancel", "Cancelar")}</button>
          <button className="btn btn-primary" data-accion="crear-cuenta" disabled={busy || !puedeCrear} onClick={() => void crea()}>
            {t("Create user", "Crear usuario")}
          </button>
        </div>
      </div>
    </div>
  );
}
