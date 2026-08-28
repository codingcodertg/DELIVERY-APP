"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ownerSignoff, revokeSignoff } from "@/app/timetracker/clock-in/actions/reports";
import { btn } from "@/lib/clockin/ui";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function SignoffButton({
  periodStart,
  signedOff,
  lang,
}: {
  periodStart: string;
  signedOff: boolean;
  lang: Lang;
}) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    const res = signedOff ? await revokeSignoff({ periodStart }) : await ownerSignoff({ periodStart });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        className={signedOff ? btn("neutral", "md") : btn("primary", "md")}
      >
        {busy ? "…" : signedOff ? tr.undoSignoff : tr.signOffPeriod}
      </button>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
