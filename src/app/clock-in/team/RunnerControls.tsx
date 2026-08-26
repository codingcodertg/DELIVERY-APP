"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeRunner, setEmployeeVehicle } from "@/app/clock-in/actions/team";
import { t, type Lang } from "@/lib/clockin/i18n";
import type { Vehicle } from "./VehiclesManager";

export default function RunnerControls({
  employeeId,
  isRunner,
  vehicleId,
  vehicles,
  lang,
}: {
  employeeId: string;
  isRunner: boolean;
  vehicleId: string | null;
  vehicles: Vehicle[];
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const activeVehicles = vehicles.filter((v) => v.active || v.id === vehicleId);

  async function toggleRunner(next: boolean) {
    setBusy(true);
    await setEmployeeRunner(employeeId, next);
    setBusy(false);
    router.refresh();
  }
  async function pickVehicle(v: string) {
    setBusy(true);
    await setEmployeeVehicle(employeeId, v || null);
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isRunner}
          disabled={busy}
          onChange={(e) => toggleRunner(e.target.checked)}
          className="accent-emerald-600 h-4 w-4"
        />
        🚚 {tr.runner}
      </label>
      {isRunner && (
        <select
          value={vehicleId ?? ""}
          disabled={busy}
          onChange={(e) => pickVehicle(e.target.value)}
          title={tr.vehicle}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs disabled:opacity-60"
        >
          <option value="">{tr.noVehicle}</option>
          {activeVehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
