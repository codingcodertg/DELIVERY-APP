"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addEmployee } from "@/app/clock-in/actions/team";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";
import { scheduleLabel } from "@/lib/clockin/schedule";

type Site = { id: string; name: string };

export default function AddEmployeeForm({ lang, sites = [] }: { lang: Lang; sites?: Site[] }) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"employee" | "manager">("employee");
  const [language, setLanguage] = useState<"en" | "es">("es");
  const [storeId, setStoreId] = useState("");
  const [schedule, setSchedule] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tempPassword: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await addEmployee({ name, email, role, language, storeId: storeId || null, schedule: schedule || null });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setResult({ tempPassword: res.tempPassword, email: res.email });
    setName("");
    setEmail("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start rounded-xl border border-emerald-400 text-emerald-700 dark:text-emerald-400 text-sm font-semibold px-4 py-2.5 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors"
      >
        + {tr.addEmployee}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{tr.addEmployee}</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
          {tr.cancel}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs text-zinc-500">{tr.fullName}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 col-span-2">
          <span className="text-xs text-zinc-500">{tr.email}</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.role}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={field}>
            <option value="employee">{tr.roleEmployee}</option>
            <option value="manager">{tr.roleManager}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.language}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)} className={field}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.store}</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
            <option value="">{tr.unassignedStore}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">{tr.scheduleType}</span>
          <select value={schedule} onChange={(e) => setSchedule(e.target.value)} className={field}>
            <option value="">{tr.noSchedule}</option>
            {(["A", "B", "C"] as const).map((k) => (
              <option key={k} value={k}>
                {scheduleLabel(k, lang)}
              </option>
            ))}
            <option value="custom">{tr.customSchedule}</option>
          </select>
        </label>
      </div>
      <button onClick={add} disabled={busy} className={btn("primary", "md")}>
        {busy ? tr.creating : tr.createAccount}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm">
          <p className="font-medium text-emerald-800 dark:text-emerald-300">{tr.accountCreated}</p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-300">{tr.shareCreds}</p>
          <p className="mt-2 font-mono text-xs">
            <span className="text-zinc-500">email:</span> {result.email}
            <br />
            <span className="text-zinc-500">password:</span>{" "}
            <span className="font-semibold">{result.tempPassword}</span>
          </p>
        </div>
      )}
    </div>
  );
}
