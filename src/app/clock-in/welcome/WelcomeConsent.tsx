"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptConsent } from "@/app/clock-in/actions/consent";
import { t, type Lang } from "@/lib/clockin/i18n";
import { btn } from "@/lib/clockin/ui";

export default function WelcomeConsent({ lang }: { lang: Lang }) {
  const tr = t(lang);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    const res = await acceptConsent();
    if (!res.ok) {
      setError(res.message ?? "Something went wrong.");
      setBusy(false);
      return;
    }
    router.push("/clock-in/clock");
    router.refresh();
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <div className="text-5xl mb-2">👋</div>
        <h1 className="text-2xl font-bold">{tr.welcomeTitle}</h1>
        <p className="mt-1 text-sm text-zinc-500 max-w-xs mx-auto">{tr.tagline}</p>
      </header>

      <section className="w-full max-w-sm">
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-300 px-2">{tr.privacySummary}</p>

        <details className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden group">
          <summary className="cursor-pointer select-none list-none px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200 flex items-center justify-between">
            {tr.privacyHeading}
            <span className="text-zinc-400 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <ul className="px-4 pb-4 flex flex-col gap-3 text-sm text-zinc-600 dark:text-zinc-300 border-t border-zinc-100 dark:border-zinc-900 pt-3">
            <li className="flex gap-2"><span>📍</span><span>{tr.consent1}</span></li>
            <li className="flex gap-2"><span>🔒</span><span>{tr.consent2}</span></li>
            <li className="flex gap-2"><span>👀</span><span>{tr.consent3}</span></li>
          </ul>
        </details>
      </section>

      <button onClick={agree} disabled={busy} className={`${btn("primary", "lg", { full: true })} max-w-sm`}>
        {busy ? "…" : tr.agree}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </main>
  );
}
