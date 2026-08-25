"use client";
import { useState, useTransition } from "react";
import { confirmDaltileMatch, rejectDaltileMatch } from "@/lib/erp/daltile-actions";

export interface DaltileRef {
  id: number;
  external_sku: string | null;
  external_url: string | null;
  external_title: string | null;
  series_name: string | null;
  nominal_size: string | null;
  finish: string | null;
  color_name: string | null;
  specs: { feature_tags?: string[]; is_made_in_usa?: boolean } | null;
  image_urls: string[] | null;
  match_method: string | null;
  match_confidence: number | null;
  match_status: string;
}

// "Daltile" card for the single-product page. Renders for any non-rejected ref.
// Confirmed refs show plainly; 'auto' (suggested) refs show a confirm/reject
// affordance for managers.
export function DaltileCard({ dref, canManage }: { dref: DaltileRef; canManage: boolean }) {
  const [status, setStatus] = useState(dref.match_status);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (status === "rejected") return null;

  const img = dref.image_urls?.[0] ?? null;
  const suggested = status === "auto";
  const conf = dref.match_confidence != null ? Math.round(dref.match_confidence * 100) : null;

  const act = (fn: (id: number) => Promise<void>, next: string) =>
    start(async () => {
      setErr(null);
      try { await fn(dref.id); setStatus(next); }
      catch (e) { setErr((e as Error).message); }
    });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Daltile</h2>
        {suggested ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            Suggested{conf != null ? ` · ${conf}%` : ""}{dref.match_method ? ` · ${dref.match_method}` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">Confirmed</span>
        )}
      </div>

      <div className="flex gap-4">
        {img && (
          <img src={img} alt={dref.external_title ?? "Daltile"} className="h-24 w-24 shrink-0 rounded-lg border object-cover" />
        )}
        <div className="min-w-0 text-sm">
          <div className="font-medium text-slate-900">{dref.external_title ?? "—"}</div>
          <div className="text-slate-500">
            {[dref.series_name, dref.nominal_size, dref.finish, dref.color_name].filter(Boolean).join(" · ") || "—"}
          </div>
          {dref.specs?.feature_tags && dref.specs.feature_tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {dref.specs.feature_tags.slice(0, 5).map((t) => (
                <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{t}</span>
              ))}
            </div>
          )}
          {dref.external_url && (
            <a href={dref.external_url} target="_blank" rel="noopener nofollow"
               className="mt-1 inline-block text-xs text-clay-600 hover:underline">
              View on daltile.com ↗
            </a>
          )}
        </div>
      </div>

      {suggested && canManage && (
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-500">Suggested match — confirm?</span>
          <button onClick={() => act(confirmDaltileMatch, "confirmed")} disabled={pending}
            className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
            Confirm
          </button>
          <button onClick={() => act(rejectDaltileMatch, "rejected")} disabled={pending}
            className="rounded-md border px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Reject
          </button>
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      )}
    </section>
  );
}
