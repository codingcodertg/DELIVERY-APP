"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addVehicle, setVehicleActive } from "@/app/timetracker/clock-in/actions/vehicles";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

export type Vehicle = { id: string; name: string; plate: string | null; active: boolean };

export default function VehiclesManager({ vehicles, lang }: { vehicles: Vehicle[]; lang: Lang }) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const filtered = q.trim() ? vehicles.filter((v) => v.name.toLowerCase().includes(q.trim().toLowerCase())) : vehicles;

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await addVehicle({ name, plate });
    setBusy(false);
    if (!res.ok) return setMsg(res.message);
    setName("");
    setPlate("");
    router.refresh();
  }

  async function toggle(id: string, active: boolean) {
    await setVehicleActive(id, active);
    router.refresh();
  }

  return (
    <details className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-5 py-4 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900">
        <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          🚚 {tr.vehicles} ({vehicles.length})
        </span>
        <span className="text-zinc-400">▾</span>
      </summary>

      <div className="p-5 pt-3">
        <div className="flex items-center justify-end">
          <button onClick={() => setOpen((o) => !o)} className="text-sm text-brand-600 hover:underline font-medium">
            {open ? tr.cancel ?? "Cancel" : `+ ${tr.addVehicle}`}
          </button>
        </div>

        {open && (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <label className="flex flex-col gap-1 flex-1 min-w-[140px]">
              <span className="text-xs text-zinc-500">{tr.vehicleName}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="White F-150" className={field} />
            </label>
            <label className="flex flex-col gap-1 w-28">
              <span className="text-xs text-zinc-500">{tr.plate}</span>
              <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ABC-1234" className={field} />
            </label>
            <button onClick={add} disabled={busy || !name.trim()} className={btn("primary", "md")}>
              {busy ? "…" : tr.add ?? "Add"}
            </button>
          </div>
        )}
        {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}

        {vehicles.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">{tr.noVehicles}</p>
        ) : (
          <>
            {vehicles.length > 6 && (
              <div className="relative mt-3">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={`🔍 ${tr.searchVehicles}`}
                  className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 pr-10 text-sm focus:outline-none focus:border-brand-500"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label="Clear"
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            <ul className="mt-2 flex flex-col">
              {filtered.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2.5 border-t border-zinc-100 dark:border-zinc-900 first:border-0">
                  <span className={v.active ? "" : "opacity-50"}>
                    <span className="font-medium">🚚 {v.name}</span>
                    {v.plate && <span className="ml-2 text-xs text-zinc-400">{v.plate}</span>}
                    {!v.active && <span className="ml-2 text-xs text-red-500">{tr.inactive}</span>}
                  </span>
                  <button onClick={() => toggle(v.id, !v.active)} className="text-xs text-brand-600 hover:underline font-medium shrink-0">
                    {v.active ? tr.deactivate ?? "Deactivate" : tr.activate ?? "Activate"}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
