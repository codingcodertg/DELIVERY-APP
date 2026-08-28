"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRunReviewed } from "@/app/timetracker/clock-in/actions/runReview";

export default function ReviewButton({
  employeeId,
  periodStart,
  initialReviewed,
  reviewedBy,
  labelReview,
  labelReviewed,
}: {
  employeeId: string;
  periodStart: string;
  initialReviewed: boolean;
  reviewedBy: string | null;
  labelReview: string;
  labelReviewed: string;
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState(initialReviewed);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const next = !reviewed;
    const res = await setRunReviewed({ employeeId, periodStart, reviewed: next });
    setBusy(false);
    if (res.ok) {
      setReviewed(next);
      router.refresh();
    }
  }

  return reviewed ? (
    <button
      onClick={toggle}
      disabled={busy}
      title={reviewedBy ? `${labelReviewed} · ${reviewedBy}` : labelReviewed}
      className="inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white px-3 py-1 text-xs font-semibold disabled:opacity-60"
    >
      ✓ {labelReviewed}
    </button>
  ) : (
    <button
      onClick={toggle}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-full border border-emerald-500 text-emerald-600 dark:text-emerald-400 px-3 py-1 text-xs font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-60"
    >
      {busy ? "…" : labelReview}
    </button>
  );
}
