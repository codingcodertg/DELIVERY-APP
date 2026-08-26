import Link from "next/link";
import { productImageUrl } from "@/lib/erp/images";

export type CategoryCard = { category: string; product_count: number; sample: { id: number; name: string }[] };

export function CategoryCards({ cards, imgMap }: { cards: CategoryCard[]; imgMap: Record<number, string> }) {
  if (cards.length === 0) {
    return <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No categories.</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Link
          key={c.category}
          href={`/erp/purchasing/categories?cat=${encodeURIComponent(c.category)}`}
          className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
            <h2 className="truncate text-sm font-semibold text-slate-800" title={c.category}>{c.category}</h2>
            <span className="shrink-0 rounded-full border border-clay-200 bg-clay-50 px-2 py-0.5 text-xs font-medium text-clay-700">
              {c.product_count.toLocaleString()}
            </span>
          </div>
          <ul className="divide-y divide-slate-50">
            {(c.sample ?? []).map((p) => {
              const url = productImageUrl(imgMap[p.id]);
              return (
                <li key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                  {url ? (
                    <img src={url} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded object-cover ring-1 ring-slate-200" />
                  ) : (
                    <div className="h-7 w-7 shrink-0 rounded bg-slate-100 ring-1 ring-slate-200" aria-hidden />
                  )}
                  <span className="truncate text-xs text-slate-600">{p.name}</span>
                </li>
              );
            })}
          </ul>
          <div className="px-4 py-2 text-xs font-medium text-clay-700">View all {c.product_count.toLocaleString()} →</div>
        </Link>
      ))}
    </div>
  );
}
