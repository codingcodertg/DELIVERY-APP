"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { money } from "@/lib/erp/utils";
import { statusLabel } from "@/lib/erp/status";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-NEXT): texto de pantalla por pares inline (usePrefs). El tipo de solicitud es enumerado fijo
// (statusLabel); nombre de campo, valores, solicitante, tienda y motivo son dato.
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
  const { t } = usePrefs();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState("");

  function act(id: number, approve: boolean, n?: string) {
    setErr(null);
    startTransition(async () => {
      const res = await decideRequest(id, approve, n);
      if (!res.ok) setErr(res.error ?? t("Failed", "Falló"));
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
        {t("No pending requests. 🎉", "Sin solicitudes pendientes. 🎉")}
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
                {t(statusLabel(r.type).en, statusLabel(r.type).es)}
              </Badge>
              {r.product ? (
                <Link href={`/erp/product/${r.product.id}`} className="font-medium hover:text-clay-700">
                  {r.product.name}
                </Link>
              ) : (
                <span className="text-slate-500">({t("product", "producto")} #{r.product_id})</span>
              )}
              {r.product && <span className="font-mono text-xs text-slate-400">{r.product.sku}</span>}
              <span className="ml-auto text-xs text-slate-400">
                {t("by", "por")} {r.requester_name ?? "—"}
                {r.requester_store ? ` · ${r.requester_store}` : ""} · {new Date(r.created_at).toLocaleDateString()}
              </span>
            </div>

            {r.reason && <p className="mb-2 text-sm text-slate-600">&ldquo;{r.reason}&rdquo;</p>}

            {r.type === "edit" &&
              (changed.length ? (
                <table className="mb-3 w-full max-w-2xl text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="py-1 pr-4 font-medium">{t("Field", "Campo")}</th>
                      <th className="py-1 pr-4 font-medium">{t("Current", "Actual")}</th>
                      <th className="py-1 pr-4 font-medium">{t("Proposed", "Propuesto")}</th>
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
                <p className="mb-3 text-sm text-slate-400">{t("No field changes specified.", "No se indicaron cambios de campo.")}</p>
              ))}
            {r.type === "reactivate" && (
              <p className="mb-3 text-sm">
                → {t("set commercial status to", "poner estado comercial en")} <span className="font-medium text-emerald-700">{t(statusLabel("active").en, statusLabel("active").es).toLowerCase()}</span>
              </p>
            )}
            {r.type === "deactivate" && (
              <p className="mb-3 text-sm">
                → {t("set commercial status to", "poner estado comercial en")} <span className="font-medium text-red-700">{t(statusLabel("inactive").en, statusLabel("inactive").es).toLowerCase()}</span>
              </p>
            )}

            {noteFor === r.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder={t("Reason for rejection…", "Motivo del rechazo…")}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="max-w-sm"
                />
                <Button size="sm" variant="outline" onClick={() => act(r.id, false, note)} disabled={pending}>
                  {t("Confirm reject", "Confirmar rechazo")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNoteFor(null);
                    setNote("");
                  }}
                >
                  {t("Cancel", "Cancelar")}
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => act(r.id, true)} disabled={pending}>
                  {t("Approve", "Aprobar")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNoteFor(r.id)} disabled={pending}>
                  {t("Reject…", "Rechazar…")}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
