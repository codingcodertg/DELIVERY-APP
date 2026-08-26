"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeActive, resetEmployeePassword } from "@/app/clock-in/actions/team";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function EmployeeActions({
  id,
  active,
  lang,
}: {
  id: string;
  active: boolean;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function doReset() {
    setBusy(true);
    setErr(null);
    const res = await resetEmployeePassword(id);
    setBusy(false);
    setOpen(false);
    if (!res.ok) return setErr(res.message);
    setTemp(res.tempPassword);
  }
  async function doToggle() {
    setBusy(true);
    await setEmployeeActive(id, !active);
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  const item = "w-full text-left px-3.5 py-2.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-60";

  return (
    <div className="relative flex flex-col items-end">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs font-medium hover:border-emerald-400 disabled:opacity-60"
      >
        {busy ? "…" : `${tr.actions} ▾`}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-44 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl py-1 flex flex-col">
            <button onClick={doReset} className={item}>
              🔑 {tr.resetPassword}
            </button>
            <button onClick={doToggle} className={item}>
              {active ? `🚫 ${tr.deactivate}` : `✅ ${tr.activate}`}
            </button>
          </div>
        </>
      )}
      {temp && (
        <span className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400 text-right">
          {tr.newPasswordLabel}: <span className="font-mono font-semibold">{temp}</span>
        </span>
      )}
      {err && <span className="mt-1 text-[11px] text-red-600 text-right">{err}</span>}
    </div>
  );
}
