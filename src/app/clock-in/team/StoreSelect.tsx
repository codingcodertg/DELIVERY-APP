"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeStore } from "@/app/clock-in/actions/team";
import { t, type Lang } from "@/lib/clockin/i18n";

type Site = { id: string; name: string };

export default function StoreSelect({
  employeeId,
  storeId,
  sites,
  lang,
}: {
  employeeId: string;
  storeId: string | null;
  sites: Site[];
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(value: string) {
    setBusy(true);
    await setEmployeeStore(employeeId, value || null);
    setBusy(false);
    router.refresh();
  }

  return (
    <select
      value={storeId ?? ""}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs disabled:opacity-60"
    >
      <option value="">{tr.unassignedStore}</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
