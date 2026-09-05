"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/timetracker-data-provider";
import { useT } from "@/lib/timetracker/i18n";
import { APP_SETTINGS, effBreaks, effTrackMode, effWorkerType } from "@/lib/timetracker/helpers";
import type { Employee } from "@/lib/timetracker/types";
import { NotificationLanguage } from "@/components/timetracker/NotificationLanguage";

// Ported (D-069) from timetracker-clean's employee/MyAccount.jsx — name/city/
// pay-info self-edit, read-only "my setup" chips (set by a manager), change
// password, and sign out of every device.
//
// G-9 (D-202): traducida entera por claves `emp.acc.*`. Los métodos de pago
// (APP_SETTINGS.paymentMethods) son DATO configurado por la empresa y se enseñan tal cual.

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
  const t = useT();
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
      <h2>{t("emp.acc.title")}</h2>
      {saved && <div className="banner ok">{t("emp.acc.saved")}</div>}
      <label>{t("emp.acc.name")}</label>
      <input value={f.fullName} onChange={(e) => upd("fullName", e.target.value)} />
      <div className="grid g2">
        <div>
          <label>{t("emp.acc.city")}</label>
          <input value={f.city} onChange={(e) => upd("city", e.target.value)} placeholder={t("emp.acc.cityPh")} />
        </div>
        <div>
          <label>{t("emp.acc.email")}</label>
          <input value={me.email || ""} disabled />
        </div>
      </div>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("emp.acc.payTitle")}</h3>
      <div className="grid g2">
        <div>
          <label>{t("emp.acc.payMethod")}</label>
          <select value={f.payMethod} onChange={(e) => upd("payMethod", e.target.value)}>
            <option value="">{t("emp.acc.payNone")}</option>
            {methods.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label>{t("emp.acc.payDetails")}</label>
          <input value={f.payDetails} onChange={(e) => upd("payDetails", e.target.value)} placeholder={t("emp.acc.payDetailsPh")} />
        </div>
      </div>
      <button style={{ marginTop: 14 }} onClick={save}>{t("common.save")}</button>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("emp.acc.setupTitle")}</h3>
      <div className="row">
        <span className="chip">{wt === "remote" ? t("emp.acc.remote") : t("emp.acc.inhouse")}</span>
        <span className="chip">{tm === "activity" ? t("emp.acc.activityTracking") : t("emp.acc.inOutOnly")}</span>
        <span className="chip">{br ? t("emp.acc.breaksOn") : t("emp.acc.breaksOff")}</span>
      </div>
      {/* El idioma de los avisos vivía en la pantalla de cuenta de fichaje, que no tenía
          nada más que esto y una contraseña que YA estaba aquí, duplicada. Traerlo deja una
          sola pantalla de "mis cosas" en vez de dos que hacían media cada una. */}
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("emp.acc.notifications")}</h3>
      <NotificationLanguage />

      <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const { updatePassword } = useData();
  const t = useT();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setMsg(""); setErr("");
    if (pw.length < 6) { setErr(t("emp.acc.pwTooShort")); return; }
    if (pw !== pw2) { setErr(t("emp.acc.pwMismatch")); return; }
    setBusy(true);
    try { await updatePassword(pw); setPw(""); setPw2(""); setMsg(t("emp.acc.pwUpdated")); }
    catch (e) { const error = e as { message?: string } | null; setErr(error?.message || t("emp.acc.pwFail")); }
    finally { setBusy(false); }
  }
  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("emp.acc.pwTitle")}</h3>
      {msg && <div className="banner ok">{msg}</div>}
      {err && <div className="banner err">{err}</div>}
      <div className="grid g2">
        <div><label>{t("emp.acc.pwNew")}</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /></div>
        <div><label>{t("emp.acc.pwConfirm")}</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && save()} /></div>
      </div>
      <button style={{ marginTop: 12 }} disabled={busy} onClick={save}>{busy ? t("emp.acc.saving") : t("emp.acc.pwUpdate")}</button>
      <SignOutEverywhere />
    </>
  );
}

// Security: revoke every other session (a shared/public computer, an old
// phone, a desktop install no longer used). This browser is signed out too.
function SignOutEverywhere() {
  const { signOutEverywhere } = useData();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (!confirm(t("emp.acc.signOutAllConfirm"))) return;
    setErr(""); setBusy(true);
    try { await signOutEverywhere(); }
    catch (e) { const error = e as { message?: string } | null; setErr(error?.message || t("emp.acc.signOutAllFail")); setBusy(false); }
  }
  return (
    <>
      <div className="hr" />
      <h3 style={{ color: "var(--tt-muted)" }}>{t("emp.acc.devices")}</h3>
      {err && <div className="banner err">{err}</div>}
      <p className="small muted" style={{ marginTop: 0 }}>{t("emp.acc.devicesNote")}</p>
      <button className="btn-danger btn-sm" disabled={busy} onClick={go}>{busy ? t("emp.acc.signingOut") : t("emp.acc.signOutAll")}</button>
    </>
  );
}
