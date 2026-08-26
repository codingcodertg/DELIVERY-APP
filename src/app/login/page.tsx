"use client";

import { useEffect, useState } from "react";
import { loginEmail } from "@/lib/username";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VersionFooter } from "@/components/VersionFooter";

const REMEMBERED_EMAIL_KEY = "rtg_remembered_email";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  // Where to return after signing in — set by middleware.ts when a guarded
  // route bounced here signed-out (e.g. `/timetracker`). Falls back to `/`,
  // same as before this existed.
  // Land on the hub, not on deliveries. Someone with the ERP, Recruiting or Time
  // Tracker should choose where they are going rather than be dropped into one
  // app (D-090). This is safe for everybody else because /home already bounces
  // anyone with fewer than two destinations onward via landingRoute() — so a
  // driver still lands on /driver and a sales rep still lands on the board.
  // An explicit ?next= from a deep link still wins over this.
  const [next, setNext] = useState("/home");

  // Prefill the last-remembered email so returning users don't retype it.
  useEffect(() => {
    const saved = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (saved) setEmail(saved);
    else setRemember(false);
    const params = new URLSearchParams(window.location.search);
    // Kicked out because the account signed in on another device.
    if (params.get("reason") === "session") {
      setMsg("You were signed out because this account signed in on another device. Only one device can be signed in at a time.");
    }
    const n = params.get("next");
    if (n && n.startsWith("/") && !n.startsWith("/login")) setNext(n);
  }, []);

  const forgot = async () => {
    setMsg("");
    if (!email) { setMsg("Enter your email first, then click 'Forgot password'."); return; }
    // A derived address receives no mail, so a reset link would go nowhere.
    // Saying so beats a cheerful "check your email" that never arrives.
    if (!email.includes("@")) {
      setMsg("That account signs in with a username and has no email — ask an admin to set a new password.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    setMsg(error ? error.message : "Check your email for a password-reset link.");
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
        setMsg("Account created. Check your email if confirmation is required, then sign in.");
        setMode("signin");
      } else {
        // A username is turned into its derived address here; a real email is
        // passed through untouched. Nothing is looked up, so there's no way to
        // probe the app for who works here.
        const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
        if (error) throw error;
        if (remember) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
        else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        router.refresh();
        router.push(next);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

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
          {mode === "signin" ? "Sign in to your workspace" : "Create your account"}
        </p>

        {mode === "signup" && (
          <div style={{ marginBottom: 12 }}>
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
        )}
        <div style={{ marginBottom: 12 }}>
          <label>Email or username</label>
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
        <div style={{ marginBottom: 16 }}>
          <label>Password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="••••••••"
              style={{ paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
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
            Remember me
          </label>
        )}

        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={submit} disabled={loading}>
          {loading ? "..." : mode === "signin" ? "Sign in" : "Sign up"}
        </button>

        {mode === "signin" && (
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button className="link-tel" style={{ background: "none", fontSize: 12.5 }} onClick={forgot} disabled={loading}>
              Forgot password?
            </button>
          </div>
        )}

        {msg && <div className="hint" style={{ marginTop: 12, color: msg.includes("Check your email") || msg.includes("created") ? "var(--green)" : "var(--red)" }}>{msg}</div>}

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 13 }}>
          {mode === "signin" ? (
            <button className="link-tel" style={{ background: "none" }} onClick={() => setMode("signup")}>
              No account? Create one
            </button>
          ) : (
            <button className="link-tel" style={{ background: "none" }} onClick={() => setMode("signin")}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
      <VersionFooter fixed />
    </div>
  );
}
