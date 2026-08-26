"use client";

import { useState } from "react";
import { createClient } from "@/lib/clockin/supabase/client";
import { btn, field } from "@/lib/clockin/ui";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function ChangePassword({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    if (pw.length < 8) return setMsg({ ok: false, text: tr.pwTooShort });
    if (pw !== pw2) return setMsg({ ok: false, text: tr.pwMismatch });
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw("");
    setPw2("");
    setMsg({ ok: true, text: tr.pwUpdated });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.changePassword}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">{tr.newPassword}</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className={field} autoComplete="new-password" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">{tr.confirmPassword}</span>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className={field} autoComplete="new-password" />
      </label>
      <button onClick={save} disabled={busy || !pw || !pw2} className={btn("primary", "md")}>
        {busy ? "…" : tr.updatePassword}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
