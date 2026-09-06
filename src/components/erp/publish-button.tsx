"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/erp/ui/button";
import { publishProduct } from "@/lib/erp/actions";
import { usePrefs } from "@/lib/prefs";
// G-10 (D-NEXT): texto de pantalla por pares inline (usePrefs).

export function PublishButton({ productId }: { productId: number }) {
  const router = useRouter();
  const { t } = usePrefs();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex items-center gap-2">
      <Button
        size="sm"
        onClick={() => {
          setErr(null);
          startTransition(async () => {
            const res = await publishProduct(productId);
            if (!res.ok) setErr(res.error);
            else router.refresh();
          });
        }}
        disabled={pending}
      >
        {pending ? t("Publishing…", "Publicando…") : t("Publish", "Publicar")}
      </Button>
      {err && <span className="text-sm text-red-600">{err}</span>}
    </span>
  );
}
