import { money } from "@/lib/erp/utils";

// Horizontal 4-tier pricing bar (ERP / Sales / Mgr / Vol) + the general-vs-specific
// and fixed-vs-leveled flags. All NON-cost (these are customer sale prices). Values
// arrive in Phase 2 from the master Excel → render gracefully when null.
export interface PricingBarProps {
  erp: number | null;
  sales: number | null;
  mgr: number | null;
  vol: number | null;
  kind: string | null; // 'general' | 'specific'
  mode: string | null; // 'fixed' | 'leveled'
  suffix?: string; // e.g. " / SF"
}

const TIERS: Array<{ key: keyof Pick<PricingBarProps, "erp" | "sales" | "mgr" | "vol">; label: string; tone: string }> = [
  { key: "erp", label: "ERP", tone: "bg-slate-100 text-slate-700" },
  { key: "sales", label: "Sales", tone: "bg-sky-50 text-sky-800" },
  { key: "mgr", label: "Mgr", tone: "bg-clay-50 text-clay-800" },
  { key: "vol", label: "Vol", tone: "bg-emerald-50 text-emerald-800" },
];

export function PricingBar(props: PricingBarProps) {
  const anyValue = [props.erp, props.sales, props.mgr, props.vol].some((v) => v != null);
  return (
    <div>
      <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-slate-200">
        {TIERS.map((t, i) => {
          const v = props[t.key];
          return (
            <div key={t.key} className={`px-3 py-2.5 text-center ${t.tone} ${i > 0 ? "border-l border-white/70" : ""}`}>
              <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{t.label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {v == null ? <span className="opacity-40">—</span> : money(v)}
                {v != null && props.suffix && <span className="text-[10px] font-normal opacity-60">{props.suffix}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <Flag value={props.kind} of={["general", "specific"]} />
        <Flag value={props.mode} of={["fixed", "leveled"]} />
        {!anyValue && <span className="text-slate-400">Prices populate in Phase 2 from the master pricing sheet.</span>}
      </div>
    </div>
  );
}

function Flag({ value, of }: { value: string | null; of: [string, string] }) {
  if (!value) return <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-400">{of[0]}/{of[1]}: —</span>;
  return (
    <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium text-slate-600">
      {value}
    </span>
  );
}
