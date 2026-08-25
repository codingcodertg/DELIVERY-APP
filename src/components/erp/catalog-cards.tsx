"use client";

import Link from "next/link";
import { Badge } from "@/components/erp/ui/badge";
import { cn } from "@/lib/erp/utils";
import { cardImageUrl } from "@/lib/erp/images";
import { commercialStatusClass, label } from "@/lib/erp/status";
import type { CatalogRow } from "@/lib/erp/catalog";

// Catalog card view — mirrors the competitor-catalog scraper's product card
// (image tile + name + collection · SKU + tag chips), reimplemented in the ERP
// theme. NON-COST by construction: nothing here reads price / cost / margin (#29).

const USA_RE = /\b(usa|u\.?s\.?a\.?|united states|made in (the )?usa)\b/i;

function categoryLeaf(path?: string | null): string | null {
  if (!path) return null;
  const parts = path.split(">").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function Card({ r }: { r: CatalogRow }) {
  const img = cardImageUrl(r);
  const typeChip = r.product_type ?? categoryLeaf(r.category_path);
  const isUsa = !!r.origin && USA_RE.test(r.origin);

  // Only chips that have values, in the spec's order. (origin becomes the USA chip when applicable.)
  const chips = [
    typeChip,
    r.size_in,
    r.finish,
    r.material,
    r.look,
    isUsa ? null : r.origin,
  ].filter((v): v is string => !!v && String(v).trim() !== "");

  return (
    <Link
      href={`/product/${r.id}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md hover:ring-1 hover:ring-clay-300"
    >
      <div className="relative aspect-square overflow-hidden bg-slate-100">
        {img ? (
          <img src={img} alt={r.name} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">no image</div>
        )}
        <span className="absolute left-2 top-2">
          <Badge className={commercialStatusClass(r.status)}>{label(r.status)}</Badge>
        </span>
        {r.needs_review && (
          <span title="Needs review" className="absolute right-2 top-2 inline-block h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
        )}
        <span
          aria-hidden
          className="absolute bottom-2 right-2 rounded-md bg-white/85 px-1.5 py-0.5 text-slate-600 opacity-0 ring-1 ring-slate-200 transition group-hover:opacity-100"
        >
          ⮕
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="line-clamp-2 text-sm font-medium leading-tight text-slate-900">{r.name}</div>
        <div className="text-xs text-slate-500">
          {r.collection && <span className="font-medium text-slate-600">{r.collection} · </span>}
          <span className="font-mono">{r.sku}</span>
        </div>
        {(chips.length > 0 || isUsa) && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {isUsa && <Badge className="border-blue-200 bg-blue-50 text-blue-700">USA</Badge>}
            {chips.map((c, i) => (
              <Badge key={`${i}-${c}`} className="border-slate-200 bg-slate-50 text-slate-600">{c}</Badge>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function CatalogCards({ rows }: { rows: CatalogRow[] }) {
  if (rows.length === 0) {
    return <div className="p-8 text-center text-sm text-slate-500">No products match these filters.</div>;
  }
  return (
    <div className={cn("grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6")}>
      {rows.map((r) => (
        <Card key={r.id} r={r} />
      ))}
    </div>
  );
}
