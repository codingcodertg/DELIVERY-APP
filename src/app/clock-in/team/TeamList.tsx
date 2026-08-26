"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/clockin/i18n";
import type { WeekPattern } from "@/lib/clockin/schedule";
import PositionSelect from "./PositionSelect";
import StoreSelect from "./StoreSelect";
import ScheduleSelect from "./ScheduleSelect";
import EmployeeActions from "./EmployeeActions";
import CustomScheduleEditor from "./CustomScheduleEditor";
import RunnerControls from "./RunnerControls";
import type { Vehicle } from "./VehiclesManager";

type Person = {
  id: string;
  full_name: string;
  role: string;
  position: string | null;
  language: string;
  active: boolean;
  store_id: string | null;
  default_schedule: string | null;
  custom_schedule: WeekPattern | null;
  is_runner: boolean;
  vehicle_id: string | null;
};
type Site = { id: string; name: string };

/** Human label for a position, in the viewer's language. */
function positionLabel(pos: string | null, tr: ReturnType<typeof t>["mgr"]): string {
  switch (pos) {
    case "office": return tr.posOffice;
    case "warehouse": return tr.posWarehouse;
    case "manager": return tr.posManager;
    case "owner": return tr.posOwner;
    default: return tr.posSales;
  }
}

export default function TeamList({
  people,
  sites,
  vehicles,
  lang,
  isOwner,
  userId,
}: {
  people: Person[];
  sites: Site[];
  vehicles: Vehicle[];
  lang: Lang;
  isOwner: boolean;
  userId: string;
}) {
  const tr = t(lang).mgr;
  const [q, setQ] = useState("");
  const [openCustom, setOpenCustom] = useState<Set<string>>(new Set());
  const toggleCustom = (id: string) =>
    setOpenCustom((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const filtered = q.trim()
    ? people.filter((p) => p.full_name.toLowerCase().includes(q.trim().toLowerCase()))
    : people;

  return (
    <details className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-5 py-4 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-900">
        <span className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          {tr.employees} ({people.length})
        </span>
        <span className="text-zinc-400">▾</span>
      </summary>

      <div className="p-5 pt-3">
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`🔍 ${tr.searchEmployees}`}
            className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 pr-10 text-sm focus:outline-none focus:border-emerald-500"
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

        {filtered.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-400">{tr.noMatches}</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {filtered.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 border-t border-zinc-100 dark:border-zinc-900 first:border-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className={p.active ? "" : "opacity-50"}>
                    <span className="font-medium">{p.full_name}</span>
                    {!p.active && <span className="ml-2 text-xs text-red-500">{tr.inactive}</span>}
                  </span>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {/* ONE control: office/sales/warehouse/manager/owner. It sets
                        the role too, so it's owner-only; everyone else sees the
                        current position as a label. Never editable on yourself. */}
                    {isOwner && p.id !== userId ? (
                      <PositionSelect employeeId={p.id} position={p.position} lang={lang} />
                    ) : (
                      <span className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-500">
                        {positionLabel(p.position, tr)}
                      </span>
                    )}
                    <ScheduleSelect employeeId={p.id} schedule={p.default_schedule} lang={lang} />
                    <StoreSelect employeeId={p.id} storeId={p.store_id} sites={sites} lang={lang} />
                    {p.id !== userId && <EmployeeActions id={p.id} active={p.active} lang={lang} />}
                  </div>
                </div>

                {/* Runner: mark them a runner + pick their current vehicle (employees only) */}
                {p.role === "employee" && (
                  <RunnerControls employeeId={p.id} isRunner={p.is_runner} vehicleId={p.vehicle_id} vehicles={vehicles} lang={lang} />
                )}

                {/* Custom weekly pattern — collapsed by default */}
                {p.default_schedule === "custom" && (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => toggleCustom(p.id)}
                      className="self-start text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {openCustom.has(p.id) ? "▾" : "▸"} {tr.customWeekly}
                    </button>
                    {openCustom.has(p.id) && (
                      <CustomScheduleEditor employeeId={p.id} pattern={p.custom_schedule} lang={lang} />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
