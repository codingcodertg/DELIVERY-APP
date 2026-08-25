"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { cn, money } from "@/lib/erp/utils";
import { productImageUrl } from "@/lib/erp/images";
import { priceUnitSuffix } from "@/lib/erp/domain/units";
import { commercialStatusClass, label } from "@/lib/erp/status";
import { addFamilyLink, removeFamilyLink, refileFamilyLink, type FamilyRelation } from "@/lib/erp/actions";

// Quick-view carries price (visible to all) + sell_unit — never cost/margin (#29).
export type FamilyMember = {
  id: number;
  sku: string;
  name: string;
  status: string;
  price: number | null;
  sell_unit: string | null;
  image_path: string | null;
};

const REL_LABEL: Record<FamilyRelation, string> = { bro: "Bros", cuz: "Cuz", sub: "Subs" };

function Thumb({ path, alt, cls }: { path: string | null; alt: string; cls: string }) {
  const url = productImageUrl(path);
  return url ? (
    <img src={url} alt={alt} loading="lazy" className={cn(cls, "shrink-0 rounded object-cover ring-1 ring-slate-200")} />
  ) : (
    <div className={cn(cls, "shrink-0 rounded bg-slate-100 ring-1 ring-slate-200")} aria-hidden />
  );
}

function MemberChip({
  m,
  relation,
  canEdit,
  onRemove,
  onRefile,
}: {
  m: FamilyMember;
  relation: FamilyRelation;
  canEdit: boolean;
  onRemove: () => void;
  onRefile: (to: FamilyRelation) => void;
}) {
  const [moving, setMoving] = useState(false);
  const others = (["bro", "cuz", "sub"] as FamilyRelation[]).filter((r) => r !== relation);
  return (
    <span className="group relative inline-flex items-center">
      <Link
        href={`/product/${m.id}`}
        className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border border-slate-200 bg-white py-0.5 pl-1 pr-2.5 text-xs hover:border-clay-300 hover:bg-clay-50"
      >
        <Thumb path={m.image_path} alt={m.sku} cls="h-6 w-6" />
        <span className="truncate font-medium text-slate-700">{m.name}</span>
      </Link>
      {canEdit && (
        <>
          <button
            type="button"
            onClick={() => setMoving((v) => !v)}
            aria-label={`Re-file ${m.name}`}
            title="Re-file (mis-categorized?)"
            className="ml-0.5 rounded-full px-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
          >
            ⇄
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${m.name}`}
            className="rounded-full px-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
          >
            ×
          </button>
          {moving && (
            <span className="absolute left-0 top-full z-40 mt-1 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
              <span className="px-1 py-0.5 text-[11px] text-slate-400">move to:</span>
              {others.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setMoving(false); onRefile(r); }}
                  className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-clay-50"
                >
                  {REL_LABEL[r]}
                </button>
              ))}
            </span>
          )}
        </>
      )}
      {/* hover quick-view (price only — #29) */}
      <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-60 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-lg group-hover:block">
        <span className="flex gap-2">
          <Thumb path={m.image_path} alt={m.sku} cls="h-14 w-14" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-slate-900">{m.name}</span>
            <span className="block font-mono text-[11px] text-slate-400">{m.sku}</span>
            <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[11px]", commercialStatusClass(m.status))}>{label(m.status)}</span>
          </span>
        </span>
        <span className="mt-2 block text-sm tabular-nums text-slate-700">
          {money(m.price)}<span className="text-xs text-slate-400">{priceUnitSuffix(m.sell_unit)}</span>
        </span>
      </span>
    </span>
  );
}

function FamilyGroup({
  productId,
  relation,
  title,
  hint,
  members,
  canEdit,
  excludeIds,
}: {
  productId: number;
  relation: FamilyRelation;
  title: string;
  hint: string;
  members: FamilyMember[];
  canEdit: boolean;
  excludeIds: Set<number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FamilyMember[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function search(query: string) {
    setQ(query);
    const clean = query.replace(/[%_,()]/g, " ").trim();
    if (clean.length < 2) { setResults([]); return; }
    const sb = createClient();
    // ARC-02: a failed search used to render as "no matches".
    try {
      const data = unwrap(
        await sb.from("app_products").select("id,sku,name,status,price,sell_unit").ilike("name", `%${clean}%`).limit(8),
        "product-family: product search",
      );
      setResults((data ?? []).filter((r) => r.id !== productId && !excludeIds.has(r.id)) as FamilyMember[]);
    } catch (e) {
      setResults([]);
      setErr(`Search failed: ${dbErrorMessage(e)}`);
    }
  }

  function mutate(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setErr(res.error ?? "failed");
      else { setAdding(false); setQ(""); setResults([]); router.refresh(); }
    });
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <span className="text-xs text-slate-400">{hint}</span>
        {canEdit && (
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="ml-auto rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            {adding ? "Close" : `+ Add ${relation}`}
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="text-xs text-slate-400">None linked.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <MemberChip
              key={m.id}
              m={m}
              relation={relation}
              canEdit={canEdit}
              onRemove={() => mutate(() => removeFamilyLink(productId, m.id, relation))}
              onRefile={(to) => mutate(() => refileFamilyLink(productId, m.id, relation, to))}
            />
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder={`Search products to add as ${relation}…`}
            className="h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
          />
          {results.length > 0 && (
            <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => mutate(() => addFamilyLink(productId, r.id, relation))}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-clay-50 disabled:opacity-50"
                  >
                    <Thumb path={null} alt={r.sku} cls="h-6 w-6" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="font-mono text-xs text-slate-400">{r.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

export function ProductFamily({
  productId,
  canEdit,
  bros,
  cuz,
  subs,
  legacyBros,
  legacyCuz,
  legacySubs,
}: {
  productId: number;
  canEdit: boolean;
  bros: FamilyMember[];
  cuz: FamilyMember[];
  subs: FamilyMember[];
  legacyBros: string | null;
  legacyCuz: string | null;
  legacySubs: string | null;
}) {
  const excludeBros = new Set(bros.map((m) => m.id));
  const excludeCuz = new Set(cuz.map((m) => m.id));
  const excludeSubs = new Set(subs.map((m) => m.id));
  return (
    <div className="space-y-4">
      <FamilyGroup productId={productId} relation="bro" title="Bros" hint="same collection, different size" members={bros} canEdit={canEdit} excludeIds={excludeBros} />
      <FamilyGroup productId={productId} relation="cuz" title="Cuz" hint="same size, different color" members={cuz} canEdit={canEdit} excludeIds={excludeCuz} />
      <FamilyGroup productId={productId} relation="sub" title="Substitutes" hint="different product, same use" members={subs} canEdit={canEdit} excludeIds={excludeSubs} />
      {(legacyBros || legacyCuz || legacySubs) && (
        <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">
          Legacy text — bros: {legacyBros || "—"} · cuz: {legacyCuz || "—"} · subs: {legacySubs || "—"}
        </p>
      )}
      {canEdit && (
        <p className="text-[11px] text-slate-400">Mis-filed? Use <span className="font-medium">⇄</span> on a chip to move it between Bros / Cuz / Substitutes.</p>
      )}
    </div>
  );
}
