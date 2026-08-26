"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSiteActive } from "@/app/clock-in/actions/sites";
import { t, type Lang } from "@/lib/clockin/i18n";

export default function SiteToggle({ id, active, lang }: { id: string; active: boolean; lang: Lang }) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await setSiteActive(id, !active);
        setBusy(false);
        router.refresh();
      }}
      disabled={busy}
      className={`text-xs ${active ? "text-zinc-400 hover:text-red-600" : "text-emerald-600 hover:underline"}`}
    >
      {busy ? "…" : active ? tr.deactivate : tr.reactivate}
    </button>
  );
}
