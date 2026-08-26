"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEmployeePosition } from "@/app/clock-in/actions/team";
import { type Position } from "@/lib/clockin/positions";
import { t, type Lang } from "@/lib/clockin/i18n";

/**
 * What someone DOES — separate from RoleSelect, which sets what they can SEE.
 * Position drives the grouping on Today's Crew; role drives permissions.
 */
export default function PositionSelect({
  employeeId,
  position,
  lang,
}: {
  employeeId: string;
  position: string | null;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(value: string) {
    setBusy(true);
    setErr(null);
    const res = await setEmployeePosition(employeeId, value as Position);
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <select
        value={position ?? "sales"}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs disabled:opacity-60"
      >
        <option value="office">{tr.posOffice}</option>
        <option value="sales">{tr.posSales}</option>
        <option value="warehouse">{tr.posWarehouse}</option>
        <option value="manager">{tr.posManager}</option>
        <option value="owner">{tr.posOwner}</option>
      </select>
      {err && <span className="text-[11px] text-red-600 mt-0.5 max-w-[140px] text-right">{err}</span>}
    </div>
  );
}
