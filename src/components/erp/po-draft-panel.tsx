"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/erp/supabase/client";
import { unwrap, dbErrorMessage } from "@/lib/erp/db-result";
import { assignDraftSku, linkDraftToProduct } from "@/lib/erp/actions";
import { Input } from "@/components/erp/ui/input";
import { Button } from "@/components/erp/ui/button";
import { money } from "@/lib/erp/utils";
import { label } from "@/lib/erp/status";

const SKU_RE = /^[A-Z0-9][A-Z0-9-]{0,63}$/;
type Target = { id: number; sku: string; name: string; status: string };

export function PoDraftPanel({
  productId,
  mpn,
  cost,
  vendorName,
}: {
  productId: number;
  mpn: string | null;
  cost: number | null;
  vendorName: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"assign" | "link">("assign");
  const [sku, setSku] = useState(mpn ? mpn.toUpperCase().replace(/[^A-Z0-9-]/g, "") : "");
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [lookupSku, setLookupSku] = useState("");
  const [target, setTarget] = useState<Target | null>(null);

  const clean = sku.trim().toUpperCase();
  const validFormat = SKU_RE.test(clean);

  function assign() {
    setErr(null);
    setWarn(null);
    if (!validFormat) {
      setErr("SKU must start alphanumeric, then uppercase letters/numbers/hyphens, ≤64 chars.");
      return;
    }
    startTransition(async () => {
      const sb = createClient();
      // ARC-02: this is the pre-assign duplicate check. A swallowed error used to read
      // as "SKU is free" and let the assign proceed unwarned.
      let data;
      try {
        data = unwrap(await sb.from("app_products").select("id,name").eq("sku", clean).limit(1), "po-draft-panel: sku check");
      } catch (e) {
        setErr(`Could not check whether ${clean} is taken: ${dbErrorMessage(e)}`);
        return;
      }
      if (data && data.length) {
        setWarn(`SKU ${clean} already exists (${data[0].name}). Use "Link to existing", or pick another.`);
        return;
      }
      const res = await assignDraftSku(productId, clean);
      if (!res.ok) setErr(res.error);
      else router.refresh();
    });
  }

  function find() {
    setErr(null);
    setTarget(null);
    startTransition(async () => {
      const sb = createClient();
      // ARC-02: a failed lookup used to report the honest-looking "No product with SKU X".
      let data;
      try {
        data = unwrap(
          await sb.from("app_products").select("id,sku,name,status").eq("sku", lookupSku.trim().toUpperCase()).maybeSingle(),
          "po-draft-panel: sku lookup",
        );
      } catch (e) {
        setErr(`Lookup failed: ${dbErrorMessage(e)}`);
        return;
      }
      if (!data) setErr(`No product with SKU ${lookupSku.trim().toUpperCase()}.`);
      else setTarget(data as Target);
    });
  }

  function link() {
    if (!target) return;
    setErr(null);
    startTransition(async () => {
      const res = await linkDraftToProduct(productId, target.id);
      if (!res.ok) setErr(res.error);
      else router.push(`/erp/product/${target.id}`);
    });
  }

  return (
    <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
        PO import — assign a SKU before publishing
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        Imported from a PO{vendorName ? ` (${vendorName})` : ""}
        {mpn ? ` · MPN ${mpn}` : ""}
        {cost != null ? ` · cost ${money(cost)}` : ""}. Give it a real internal SKU, or link it to an existing product.
      </p>

      <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => setMode("assign")}
          className={mode === "assign" ? "rounded-md bg-clay-50 px-3 py-1 text-sm font-medium text-clay-700" : "px-3 py-1 text-sm text-slate-500"}
        >
          Assign new SKU
        </button>
        <button
          type="button"
          onClick={() => setMode("link")}
          className={mode === "link" ? "rounded-md bg-clay-50 px-3 py-1 text-sm font-medium text-clay-700" : "px-3 py-1 text-sm text-slate-500"}
        >
          Link to existing
        </button>
      </div>

      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      {warn && <p className="mb-2 text-sm text-amber-700">{warn}</p>}

      {mode === "assign" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="INTERNAL-SKU" className="max-w-xs font-mono" />
          {!validFormat && clean !== "" && <span className="text-xs text-red-500">invalid format</span>}
          <Button onClick={assign} disabled={pending || !validFormat}>
            Assign SKU
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input value={lookupSku} onChange={(e) => setLookupSku(e.target.value)} placeholder="existing SKU" className="max-w-xs" />
            <Button variant="outline" onClick={find} disabled={pending || !lookupSku.trim()}>
              Find
            </Button>
          </div>
          {target && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm">
              <span className="font-mono">{target.sku}</span> — {target.name} ({label(target.status)})
              <Button size="sm" className="ml-auto" onClick={link} disabled={pending}>
                Link &amp; archive draft
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
