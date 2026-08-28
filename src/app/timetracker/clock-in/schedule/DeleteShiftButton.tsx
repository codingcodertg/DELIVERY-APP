"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteShift } from "@/app/timetracker/clock-in/actions/schedule";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function DeleteShiftButton({ id, lang }: { id: string; lang: Lang }) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function doDelete() {
    setBusy(true);
    await deleteShift(id);
    setBusy(false);
    router.refresh();
  }

  // Two-tap: the ✕ asks first, so a stray tap never wipes a shift.
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={doDelete} disabled={busy} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">
          {busy ? "…" : tr.removeShift}
        </button>
        <button onClick={() => setConfirming(false)} className="text-xs text-zinc-400 hover:text-zinc-600">
          {tr.keep}
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={tr.removeShift}
      aria-label={tr.removeShift}
      className="text-xs text-zinc-400 hover:text-red-600"
    >
      ✕
    </button>
  );
}
