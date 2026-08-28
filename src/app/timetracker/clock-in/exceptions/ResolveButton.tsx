"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveException } from "@/app/timetracker/clock-in/actions/exceptions";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn } from "@/lib/clockin/ui";

export default function ResolveButton({ id, lang }: { id: string; lang: Lang }) {
  const tr = t(lang).mgr;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        await resolveException(id);
        setBusy(false);
        router.refresh();
      }}
      disabled={busy}
      className={btn("primary", "sm")}
    >
      {busy ? "…" : tr.markReviewed}
    </button>
  );
}
