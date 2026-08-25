"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { money } from "@/lib/erp/utils";
import { label } from "@/lib/erp/status";
import { decideRequest } from "@/lib/erp/actions";

type Product = {
  id: number;
  sku: string;
  name: string;
  status: string;
  [k: string]: unknown;
};

export type ReviewRequest = {
  id: number;
  type: string;
  product_id: number | null;
  payload: Record<string, unknown>;
  reason: string | null;
  requester: string | null;
  requester_store: string | null;
  created_at: string;
  product: Product | null;
  requester_name: string | null;
};

const typePill: Record<string, string> = {
  edit: "border-sky-200 bg-sky-50 text-sky-700",
  reactivate: "border-emerald-200 bg-emerald-50 text-emerald-700",
  deactivate: "border-red-200 bg-red-50 text-red-700",
};

function fmt(k: string, v: unknown, canSeeCost: boolean): string {
  if (k === "cost" && !canSeeCost) return "—";
  if (v === null || v === undefined || v === "") return "—";
  if (k === "price" || k === "cost") return money(v as number);
  return String(v);
}

export function RequestReview({
  requests,
  canSeeCost,
  editable,
}: {
  requests: ReviewRequest[];
  canSeeCost: boolean;
  editable: string[];
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState("");

  function act(id: number, approve: boolean, n?: string) {
    setErr(null);
    startTransition(async () => {
      const res = await decideRequest(id, approve, n);
      if (!res.ok) setErr(res.error ?? "Failed");
      else {
        setNoteFor(null);
        setNote("");
        router.refresh();
      }
    });
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No pending requests. 🎉
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-red-600">{err}</p>}
      {requests.map((r) => {
        const changed = r.type === "edit" ? editable.filter((k) => r.payload && k in r.payload) : [];
        return (
          <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge className={typePill[r.type] ?? "border-slate-200 bg-slate-100 text-slate-600"}>
                {label(r.type)}
              </Badge>
              {r.product ? (
                <Link href={`/product/${r.product.id}`} className="font-medium hover:text-clay-700">
                  {r.product.name}
                </Link>
              ) : (
                <span className="text-slate-500">(product #{r.product_id})</span>
              )}
              {r.product && <span className="font-mono text-xs text-slate-400">{r.product.sku}</span>}
              <span className="ml-auto text-xs text-slate-400">
                by {r.requester_name ?? "—"}
                {r.requester_store ? ` · ${r.requester_store}` : ""} · {new Date(r.created_at).toLocaleDateString()}
              </span>
            </div>

            {r.reason && <p className="mb-2 text-sm text-slate-600">&ldquo;{r.reason}&rdquo;</p>}

            {r.type === "edit" &&
              (changed.length ? (
                <table className="mb-3 w-full max-w-2xl text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1 pr-4 font-medium">Field</th>
                      <th className="py-1 pr-4 font-medium">Current</th>
                      <th className="py-1 pr-4 font-medium">Proposed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((k) => (
                      <tr key={k} className="border-t border-slate-100">
                        <td className="py-1 pr-4 text-slate-500">{k}</td>
                        <td className="py-1 pr-4">{fmt(k, r.product?.[k], canSeeCost)}</td>
                        <td className="py-1 pr-4 font-medium text-clay-700">{fmt(k, r.payload[k], canSeeCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mb-3 text-sm text-slate-400">No field changes specified.</p>
              ))}
            {r.type === "reactivate" && (
              <p className="mb-3 text-sm">
                → set commercial status to <span className="font-medium text-emerald-700">active</span>
              </p>
            )}
            {r.type === "deactivate" && (
              <p className="mb-3 text-sm">
                → set commercial status to <span className="font-medium text-red-700">inactive</span>
              </p>
            )}

            {noteFor === r.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Reason for rejection…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="max-w-sm"
                />
                <Button size="sm" variant="outline" onClick={() => act(r.id, false, note)} disabled={pending}>
                  Confirm reject
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNoteFor(null);
                    setNote("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => act(r.id, true)} disabled={pending}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNoteFor(r.id)} disabled={pending}>
                  Reject…
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
