"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/erp/utils";
import { PERIODS } from "@/lib/erp/analytics";

export function AnalyticsControls({
  period,
  stores,
  store,
}: {
  period: string;
  stores?: { id: string; name: string }[];
  store?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function setParam(k: string, v: string) {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {PERIODS.map((p) => (
          <button
            key={p.v}
            type="button"
            onClick={() => setParam("period", p.v)}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              period === p.v ? "bg-clay-50 font-medium text-clay-700" : "text-slate-500 hover:text-slate-800"
            )}
          >
            {p.l}
          </button>
        ))}
      </div>
      {stores && (
        <select
          value={store ?? ""}
          onChange={(e) => setParam("store", e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}
