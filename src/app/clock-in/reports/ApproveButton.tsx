"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { approveTimesheet, unapproveTimesheet } from "@/app/clock-in/actions/reports";
import { btn } from "@/lib/clockin/ui";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function ApproveButton({
  employeeId,
  periodStart,
  approved,
  locked,
  lang,
}: {
  employeeId: string;
  periodStart: string;
  approved: boolean;
  locked: boolean;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    if (approved) await unapproveTimesheet({ employeeId, periodStart });
    else await approveTimesheet({ employeeId, periodStart });
    setBusy(false);
    router.refresh();
  }

  if (approved) {
    return (
      <button
        onClick={toggle}
        disabled={busy || locked}
        className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-sm font-semibold px-3 py-1.5 disabled:opacity-60 hover:bg-emerald-200 dark:hover:bg-emerald-900/40 transition-colors"
        title={locked ? tr.periodLocked : tr.tapToUnapprove}
      >
        ✓ {tr.approved}
      </button>
    );
  }
  return (
    <button onClick={toggle} disabled={busy || locked} className={btn("primary", "sm")}>
      {busy ? "…" : tr.approve}
    </button>
  );
}
