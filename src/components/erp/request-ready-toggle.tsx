"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import { setRequestReady } from "@/lib/erp/actions";
import { failText } from "@/lib/erp/messages";
import { usePrefs } from "@/lib/prefs";
// G-10 (D-204): texto de pantalla por pares inline (usePrefs).

/**
 * REQUESTER STATUS de la hoja del dueño: quien pidió marca su solicitud pendiente como lista o la
 * vuelve a «no lista». Solo pendientes; la base (set_request_ready, 158) exige que sea suya.
 */
export function RequestReadyToggle({ requestId, ready }: { requestId: number; ready: boolean }) {
  const router = useRouter();
  const { t } = usePrefs();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setErr(null);
          startTransition(async () => {
            const res = await setRequestReady(requestId, !ready);
            if (!res.ok) setErr(failText(res, t));
            else router.refresh();
          });
        }}
      >
        {ready ? t("Mark not ready", "Marcar no lista") : t("Mark ready", "Marcar lista")}
      </Button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
