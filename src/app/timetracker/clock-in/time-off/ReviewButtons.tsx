"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reviewTimeOff } from "@/app/timetracker/clock-in/actions/timeoff";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn, field } from "@/lib/clockin/ui";

export default function ReviewButtons({ id, lang }: { id: string; lang: Lang }) {
  const tr = t(lang);
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(decision: "approved" | "denied") {
    setBusy(true);
    await reviewTimeOff({ id, decision, comment: comment || undefined });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={tr.optionalComment}
        className={field}
      />
      <div className="flex gap-2">
        <button onClick={() => review("approved")} disabled={busy} className={btn("primary", "sm", { full: true })}>
          {tr.approve}
        </button>
        <button onClick={() => review("denied")} disabled={busy} className={btn("neutral", "sm", { full: true })}>
          {tr.deny}
        </button>
      </div>
    </div>
  );
}
