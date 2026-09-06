"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inlineFix } from "@/lib/erp/actions";
import { failText } from "@/lib/erp/messages";
import { Input } from "@/components/erp/ui/input";
import { usePrefs } from "@/lib/prefs";
// G-10 (D-204): texto de pantalla por pares inline (usePrefs).

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
  const { t } = usePrefs();
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
      setErr(failText(res, t));
    } else {
      setState("saved");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs text-slate-500">{t("SEO title", "Título SEO")}</span>
        <Input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setState("idle"); }}
          placeholder={t("Concise, keyword-rich page title", "Título de página conciso y con palabras clave")}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-slate-500">{t("SEO description", "Descripción SEO")}</span>
        <textarea
          rows={3}
          value={desc}
          onChange={(e) => { setDesc(e.target.value); setState("idle"); }}
          placeholder={t("~150–160 character meta description", "Meta descripción de ~150–160 caracteres")}
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
        />
        <span className="text-xs text-slate-400">{desc.length} {t("chars", "caracteres")}</span>
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || state === "saving"}
          className="rounded-md bg-clay-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-clay-700 disabled:opacity-50"
        >
          {state === "saving" ? t("Saving…", "Guardando…") : t("Save SEO", "Guardar SEO")}
        </button>
        {state === "saved" && !dirty && <span className="text-xs text-emerald-600">{t("Saved ✓", "Guardado ✓")}</span>}
        {state === "error" && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
