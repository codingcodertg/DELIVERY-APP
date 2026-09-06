"use client";

import { useState, useTransition } from "react";
import { suggestFix } from "@/lib/erp/actions";
import { usePrefs } from "@/lib/prefs";
// G-10 (D-NEXT): texto de pantalla por pares inline (usePrefs).

// Lightweight "suggest a fix" — files a product_request into the M1.5 approvals
// loop. Available to everyone (staff included); a manager reviews + approves.
export function SuggestFixButton({ productId }: { productId: number }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return <span className="text-xs text-emerald-600">{t("✓ Thanks — your suggestion was filed for review.", "✓ Gracias — tu sugerencia quedó registrada para revisión.")}</span>;
  }

  function submit() {
    setErr(null);
    start(async () => {
      const res = await suggestFix(productId, reason);
      if (res.ok) setDone(true);
      else setErr(res.error);
    });
  }

  return (
    <div className="inline-block">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {t("Suggest a fix", "Sugerir un arreglo")}
        </button>
      ) : (
        <div className="w-72 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={t("What's wrong / what should change?", "¿Qué está mal / qué habría que cambiar?")}
            className="w-full rounded-md border border-slate-300 p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
          />
          {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
          <div className="mt-1.5 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-xs text-slate-500 hover:underline">
              {t("Cancel", "Cancelar")}
            </button>
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={submit}
              className="rounded-md bg-clay-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-clay-700 disabled:opacity-50"
            >
              {pending ? t("Sending…", "Enviando…") : t("Submit", "Enviar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
