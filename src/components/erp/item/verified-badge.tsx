"use client";

import { verifiedView } from "@/lib/erp/item-dashboard";
import { PILL } from "@/lib/erp/status";
import { usePrefs } from "@/lib/prefs";

// G-10 (D-204): verifiedView da label y title como pares {en, es}; aquí se elige con t(). Pasa a
// componente de cliente para poder leer el idioma: no tenía nada de servidor y ya vivía dentro de
// product-detail (cliente).

// ✓ human-reviewed · ✓✓ confirmed against the supplier scrape (product_external_refs).
export function VerifiedBadge({ level, hasConfirmedRef }: { level: number | null | undefined; hasConfirmedRef?: boolean }) {
  const { t } = usePrefs();
  const v = verifiedView(level, hasConfirmedRef);
  const tone = v.marks === 2 ? PILL.green : v.marks === 1 ? PILL.blue : PILL.gray;
  return (
    <span title={t(v.title.en, v.title.es)} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {v.marks > 0 && <span className="font-bold leading-none">{v.symbol}</span>}
      {t(v.label.en, v.label.es)}
    </span>
  );
}
