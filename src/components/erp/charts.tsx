// Zero-dependency, server-rendered chart primitives (pure SVG/CSS, no client JS).
// Cost-safe by construction: they render whatever counts the caller passes.
import type { ReactNode } from "react";

export function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className ?? ""}`}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export type BarItem = { label: string; value: number };

export function BarList({
  items,
  barClass = "bg-clay-500",
  emptyText = "Nothing to show.",
}: {
  items: BarItem[];
  barClass?: string;
  emptyText?: string;
}) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-400">{emptyText}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-slate-600" title={it.label}>{it.label}</span>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div className={`h-2.5 rounded-full ${barClass}`} style={{ width: `${Math.max(2, (it.value / max) * 100)}%` }} />
          </div>
          <span className="text-right tabular-nums text-slate-500">{it.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export type DonutSegment = { label: string; value: number; color: string };

export function Donut({ segments, size = 150, thickness = 20 }: { segments: DonutSegment[]; size?: number; thickness?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
          {total > 0 &&
            segments.map((seg) => {
              const len = (seg.value / total) * circ;
              const el = (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${len} ${circ - len}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{total.toLocaleString()}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400">total</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: seg.color }} />
            <span className="text-slate-600">{seg.label}</span>
            <span className="tabular-nums text-slate-400">{seg.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function CoverageStat({
  label,
  value,
  total,
  color = "bg-clay-500",
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
        <span className="text-xs text-slate-400">
          {value.toLocaleString()} / {total.toLocaleString()}
        </span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
