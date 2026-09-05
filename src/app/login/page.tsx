"use client";

import { useEffect, useState } from "react";
import { loginEmail } from "@/lib/username";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { usePrefs } from "@/lib/prefs";
import { VersionFooter } from "@/components/VersionFooter";
import { safeNext } from "@/lib/auth-redirect";
import {
  loadAccounts, saveAccounts, upsertAccount, removeAccount, type RememberedAccount,
} from "@/lib/remembered-accounts";

/**
 * La puerta de entrada a todos los módulos (D-090).
 *
 * Desde D-193 este aparato recuerda una LISTA de cuentas, no un solo email: en un teléfono o
 * PC de tienda por el que pasa media plantilla, el único email recordado se pisaba cada vez
 * que entraba otra persona. Las cuentas se enseñan como tarjetas; tocar una prerrellena el
 * identificador y pide SOLO la contraseña. Nunca se guarda una contraseña ni un token, así que
 * "si cambió la contraseña, deja de entrar" se cumple solo: siempre se pide, y vale la nueva.
 * "Remember me" pasa a significar "guardar esta cuenta en la lista"; desmarcado, se quita.
 *
 * Y se traduce entero con `usePrefs().t(en, es)`, el patrón del módulo base: era la pantalla
 * que ve todo el mundo y la única sin traducir.
 */
export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const { t } = usePrefs();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<RememberedAccount[]>([]);
  // La tarjeta elegida, o null para el formulario vacío ("Otra cuenta"). Mientras haya
  // cuentas y no se haya elegido ninguna, se enseña la lista.
  const [picked, setPicked] = useState<RememberedAccount | null>(null);
  const [showList, setShowList] = useState(false);
  // Where to return after signing in — set by middleware.ts when a guarded
  // route bounced here signed-out (e.g. `/timetracker`). Falls back to `/home`:
  // someone with the ERP, Recruiting or Time Tracker should choose where they
  // are going rather than be dropped into one app (D-090). /home already
  // bounces anyone with fewer than two destinations onward via landingRoute().
  const [next, setNext] = useState("/home");

  useEffect(() => {
    const list = loadAccounts(localStorage);
    setAccounts(list);
    setShowList(list.length > 0);
    const params = new URLSearchParams(window.location.search);
    setNext(safeNext(params.get("next")));
    // De /auth/callback cuando el enlace del correo no pudo canjearse (caducado, ya usado).
    const err = params.get("error");
    if (err) { setMsg(t("The link is no longer valid: ", "El enlace ya no es válido: ") + err); setMsgOk(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = (text: string, ok = false) => { setMsg(text); setMsgOk(ok); };

  const pick = (a: RememberedAccount) => {
    setPicked(a);
    setEmail(a.identifier);
    setPassword("");
    setRemember(true);
    setShowList(false);
    setMsg("");
  };
  const other = () => {
    setPicked(null);
    setEmail("");
    setPassword("");
    setShowList(false);
    setMsg("");
  };
  const forget = (a: RememberedAccount) => {
    const list = removeAccount(accounts, a.identifier);
    saveAccounts(localStorage, list);
    setAccounts(list);
    if (picked && picked.identifier === a.identifier) other();
    if (list.length === 0) setShowList(false);
  };

  const forgot = async () => {
    setMsg("");
    if (!email) { say(t("Enter your email first, then tap 'Forgot password'.", "Escribe tu correo primero y luego toca 'Olvidé mi contraseña'.")); return; }
    // A derived address receives no mail, so a reset link would go nowhere.
    // Saying so beats a cheerful "check your email" that never arrives.
    if (!email.includes("@")) {
      say(t("That account signs in with a username and has no email — ask an admin to set a new password.",
            "Esa cuenta entra con usuario y no tiene correo: pide a un administrador que te ponga una contraseña nueva."));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (error) say(error.message);
    else say(t("Check your email for a password-reset link.", "Revisa tu correo: te mandamos un enlace para cambiar la contraseña."), true);
  };

  /** Tras entrar: guarda o quita la cuenta en la lista de este aparato. Nunca la contraseña. */
  const rememberAccount = async (identifier: string) => {
    let list = accounts;
    if (remember) {
      // El nombre para la tarjeta sale de profiles; el login no lo conoce antes de entrar.
      // Si no se puede leer, la tarjeta queda solo con el identificador.
      let displayName = "";
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
          displayName = (data?.full_name as string | null) ?? "";
        }
      } catch { /* la lista es una comodidad: sin nombre también sirve */ }
      list = upsertAccount(accounts, { identifier, displayName }, Date.now());
    } else {
      list = removeAccount(accounts, identifier);
    }
    saveAccounts(localStorage, list);
    setAccounts(list);
  };

  const submit = async () => {
    setMsg("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name || email.split("@")[0] } },
        });
        if (error) throw error;
        say(t("Account created. Check your email if confirmation is required, then sign in.",
              "Cuenta creada. Revisa tu correo si hace falta confirmarla, y luego entra."), true);
        setMode("signin");
      } else {
        // A username is turned into its derived address here; a real email is
        // passed through untouched. Nothing is looked up, so there's no way to
        // probe the app for who works here.
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
        if (error) throw error;
        await rememberAccount(email);
        router.refresh();
        router.push(next);
      }
    } catch (e) {
      say((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const listView = mode === "signin" && showList && accounts.length > 0;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {/* The sign-in page is the front door to every module now, not just
            deliveries (D-090) — the ERP, Recruiting and Time Tracker all land
            here first, so the brand is the company rather than one app. */}
        <h1>
          RODRIGUEZ TILE GROUP<span>·HUB</span>
        </h1>
        <p style={{ color: "var(--gray)", marginBottom: 20, fontSize: 13 }}>
          {mode === "signin"
            ? (listView ? t("Who is signing in?", "¿Quién entra?") : t("Sign in to your workspace", "Entra a tu espacio de trabajo"))
            : t("Create your account", "Crea tu cuenta")}
        </p>

        {listView ? (
          <>
            {/* Las cuentas que este aparato recuerda. Tocar una prerrellena el identificador y
                pide la contraseña; la ✕ la quita de la lista, nada más (no cierra ninguna sesión). */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {accounts.map((a) => (
                <div key={a.identifier} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => pick(a)}
                    style={{ flex: 1, justifyContent: "flex-start", textAlign: "left", padding: "10px 12px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}
                  >
                    <span style={{ fontWeight: 700 }}>{a.displayName || a.identifier}</span>
                    {a.displayName && <span style={{ fontSize: 12, color: "var(--gray)" }}>{a.identifier}</span>}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => forget(a)}
                    title={t("Remove from this device", "Quitar de este aparato")}
                    aria-label={t("Remove {name} from this device", "Quitar a {name} de este aparato").replace("{name}", a.displayName || a.identifier)}
                    style={{ width: 40, justifyContent: "center", color: "var(--gray)" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button className="btn" style={{ width: "100%", justifyContent: "center" }} onClick={other}>
              {t("Another account", "Otra cuenta")}
            </button>
          </>
        ) : (
          <>
            {mode === "signup" && (
              <div style={{ marginBottom: 12 }}>
                <label>{t("Full name", "Nombre completo")}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Your name", "Tu nombre")} />
              </div>
            )}

            {picked ? (
              // Cuenta elegida de la lista: el identificador va fijo; solo se pide la contraseña.
              <div style={{ marginBottom: 12 }}>
                <label>{t("Account", "Cuenta")}</label>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{picked.displayName || picked.identifier}</div>
                    {picked.displayName && <div style={{ fontSize: 12, color: "var(--gray)" }}>{picked.identifier}</div>}
                  </div>
                  <button type="button" className="link-tel" style={{ background: "none", fontSize: 12.5 }} onClick={() => { setShowList(true); setPicked(null); }}>
                    {t("Change", "Cambiar")}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <label>{t("Email or username", "Correo o usuario")}</label>
                <input
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com  ·  maximo"
                />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label>{t("Password", "Contraseña")}</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="••••••••"
                  autoFocus={!!picked}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? t("Hide password", "Ocultar contraseña") : t("Show password", "Mostrar contraseña")}
                  style={{
                    position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                    width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: 6, color: "var(--gray)", fontSize: 15,
                  }}
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {mode === "signin" && (
              <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 16, textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--text)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  style={{ width: 15, height: 15 }}
                />
                {t("Remember this account on this device", "Recordar esta cuenta en este aparato")}
              </label>
            )}

            <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={loading}>
              {loading ? "..." : mode === "signin" ? t("Sign in", "Entrar") : t("Sign up", "Crear cuenta")}
            </button>

            {mode === "signin" && (
              <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {accounts.length > 0 && !picked ? (
                  <button className="link-tel" style={{ background: "none", fontSize: 12.5 }} onClick={() => setShowList(true)} disabled={loading}>
                    {t("Saved accounts", "Cuentas guardadas")}
                  </button>
                ) : <span />}
                <button className="link-tel" style={{ background: "none", fontSize: 12.5 }} onClick={forgot} disabled={loading}>
                  {t("Forgot password?", "¿Olvidaste la contraseña?")}
                </button>
              </div>
            )}
          </>
        )}

        {msg && <div className="hint" style={{ marginTop: 12, color: msgOk ? "var(--green)" : "var(--red)" }}>{msg}</div>}

        {!listView && (
          <div style={{ marginTop: 16, textAlign: "center", fontSize: 13 }}>
            {mode === "signin" ? (
              <button className="link-tel" style={{ background: "none" }} onClick={() => { setMode("signup"); setPicked(null); }}>
                {t("No account? Create one", "¿Sin cuenta? Crea una")}
              </button>
            ) : (
              <button className="link-tel" style={{ background: "none" }} onClick={() => setMode("signin")}>
                {t("Already have an account? Sign in", "¿Ya tienes cuenta? Entra")}
              </button>
            )}
          </div>
        )}
      </div>
      <VersionFooter fixed />
    </div>
  );
}
