"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inlineFix } from "@/lib/erp/actions";
import { Input } from "@/components/erp/ui/input";

// Inline SEO editor for the product detail page (manager/admin only — gated by update_product).
// Saves seo_title + seo_description via the same RPC path as the quick-edit drawer.
export function SeoEditor({
  productId,
  initialTitle,
  initialDescription,
}: {
  productId: number;
  initialTitle: string;
  initialDescription: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [desc, setDesc] = useState(initialDescription);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const dirty = title !== initialTitle || desc !== initialDescription;

  async function save() {
    setState("saving");
    setErr(null);
    const res = await inlineFix(productId, { seo_title: title, seo_description: desc });
    if (!res.ok) {
      setState("error");
      setErr(res.error);
    } else {
      setState("saved");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs text-slate-500">SEO title</span>
        <Input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setState("idle"); }}
          placeholder="Concise, keyword-rich page title"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-slate-500">SEO description</span>
        <textarea
          rows={3}
          value={desc}
          onChange={(e) => { setDesc(e.target.value); setState("idle"); }}
          placeholder="~150–160 character meta description"
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
        />
        <span className="text-xs text-slate-400">{desc.length} chars</span>
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || state === "saving"}
          className="rounded-md bg-clay-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-700 disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : "Save SEO"}
        </button>
        {state === "saved" && !dirty && <span className="text-xs text-emerald-600">Saved ✓</span>}
        {state === "error" && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
