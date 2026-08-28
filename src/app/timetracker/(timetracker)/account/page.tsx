"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { APP_SETTINGS, effBreaks, effTrackMode, effWorkerType } from "@/lib/timetracker/helpers";
import type { Employee } from "@/lib/timetracker/types";
import { NotificationLanguage } from "@/components/timetracker/NotificationLanguage";

// Ported (D-069) from timetracker-clean's employee/MyAccount.jsx — name/city/
// pay-info self-edit, read-only "my setup" chips (set by a manager), change
// password, and sign out of every device.

function blank(me: Employee) {
  return {
    fullName: me.fullName || "",
    city: me.city || "",
    payMethod: me.payMethod || "",
    payDetails: me.payDetails || "",
  };
}

export default function MyAccountPage() {
  const { me, updateMyAccount } = useData();
  const [f, setF] = useState(() => blank(me));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setF(blank(me)); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = <K extends keyof ReturnType<typeof blank>>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));
  const methods = APP_SETTINGS.paymentMethods || [];

  async function save() {
    if (f.fullName.trim().length < 2) return;
    await updateMyAccount(f);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const wt = effWorkerType(me), tm = effTrackMode(me), br = effBreaks(me);
  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <h2>My account</h2>
      {saved && <div className="banner ok">Saved.</div>}
      <label>Name</label>
      <input value={f.fullName} onChange={(e) => upd("fullName", e.target.value)} />
      <div className="grid g2">
        <div>
          <label>City</label>
          <input value={f.city} onChange={(e) => upd("city", e.target.value)} placeholder="Austin, TX" />
        </div>
        <div>
          <label>Email</label>
          <input value={me.email || ""} disabled />
        </div>
      </div>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>How I get paid</h3>
      <div className="grid g2">
        <div>
          <label>Payment method</label>
          <select value={f.payMethod} onChange={(e) => upd("payMethod", e.target.value)}>
            <option value="">(none)</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>Details (account / PayPal / phone)</label>
          <input value={f.payDetails} onChange={(e) => upd("payDetails", e.target.value)} placeholder="e.g. Chase ••••1234 or PayPal email" />
        </div>
      </div>
      <button style={{ marginTop: 14 }} onClick={save}>Save</button>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>My setup (set by the manager)</h3>
      <div className="row">
        <span className="chip">{wt === "remote" ? "Remote" : "In-house"}</span>
        <span className="chip">{tm === "activity" ? "Activity tracking" : "Clock in / out only"}</span>
        <span className="chip">{br ? "Lunch & break: on" : "Lunch & break: off"}</span>
      </div>
      {/* El idioma de los avisos vivía en la pantalla de cuenta de fichaje, que no tenía
          nada más que esto y una contraseña que YA estaba aquí, duplicada. Traerlo deja una
          sola pantalla de "mis cosas" en vez de dos que hacían media cada una. */}
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>Notifications</h3>
      <NotificationLanguage />

      <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const { updatePassword } = useData();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setMsg(""); setErr("");
    if (pw.length < 6) { setErr("Password must be at least 6 characters."); return; }
    if (pw !== pw2) { setErr("Passwords do not match."); return; }
    setBusy(true);
    try { await updatePassword(pw); setPw(""); setPw2(""); setMsg("Password updated."); }
    catch (e) { const error = e as { message?: string } | null; setErr(error?.message || "Could not update password."); }
    finally { setBusy(false); }
  }
  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>Change password</h3>
      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err">{err}</div>}
      <div className="grid g2">
        <div><label>New password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /></div>
        <div><label>Confirm password</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && save()} /></div>
      </div>
      <button style={{ marginTop: 12 }} disabled={busy} onClick={save}>{busy ? "Saving…" : "Update password"}</button>
      <SignOutEverywhere />
    </>
  );
}

// Security: revoke every other session (a shared/public computer, an old
// phone, a desktop install no longer used). This browser is signed out too.
function SignOutEverywhere() {
  const { signOutEverywhere } = useData();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (!confirm("Sign out of every device, including this one? You will need to log in again everywhere.")) return;
    setErr(""); setBusy(true);
    try { await signOutEverywhere(); }
    catch (e) { const error = e as { message?: string } | null; setErr(error?.message || "Could not sign out everywhere."); setBusy(false); }
  }
  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>Devices</h3>
      {err && <div className="banner err">{err}</div>}
      <p className="small muted" style={{ marginTop: 0 }}>Signed in somewhere you don&apos;t recognize? This revokes every session for your account.</p>
      <button className="btn-danger btn-sm" disabled={busy} onClick={go}>{busy ? "Signing out…" : "Sign out of all devices"}</button>
    </>
  );
}
