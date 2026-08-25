import { verifiedView } from "@/lib/erp/item-dashboard";
import { PILL } from "@/lib/erp/status";

// ✓ human-reviewed · ✓✓ confirmed against the supplier scrape (product_external_refs).
export function VerifiedBadge({ level, hasConfirmedRef }: { level: number | null | undefined; hasConfirmedRef?: boolean }) {
  const v = verifiedView(level, hasConfirmedRef);
  const tone = v.marks === 2 ? PILL.green : v.marks === 1 ? PILL.blue : PILL.gray;
  return (
    <span title={v.title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {v.marks > 0 && <span className="font-bold leading-none">{v.symbol}</span>}
      {v.label}
    </span>
  );
}
