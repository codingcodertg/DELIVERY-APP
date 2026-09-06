"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/erp/supabase/client";
import { usePrefs } from "@/lib/prefs";
// G-10 (D-204): texto de pantalla por pares inline (usePrefs).
// Los nombres de las vistas (guardadas y prefijadas) son dato: los da quien las guarda o el llamador.

export type SavedView = { id: number; name: string; state: Record<string, unknown> };
export type Builtin = { name: string; state: Record<string, unknown> };

export function SavedViews({
  scope,
  saved,
  builtins,
  currentState,
  onApply,
}: {
  scope: "catalog" | "review";
  saved: SavedView[];
  builtins: Builtin[];
  currentState: Record<string, unknown>;
  onApply: (s: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const name = window.prompt(t("Name this view:", "Nombre de la vista:"));
    if (!name?.trim()) return;
    setBusy(true);
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (user) await sb.from("saved_views").insert({ user_id: user.id, scope, name: name.trim(), state: currentState });
    setBusy(false);
    router.refresh();
  }
  async function rename(v: SavedView) {
    const name = window.prompt(t("Rename view:", "Renombrar vista:"), v.name);
    if (!name?.trim()) return;
    await createClient().from("saved_views").update({ name: name.trim() }).eq("id", v.id);
    router.refresh();
  }
  // G-6 (D-198): borraba sin confirmar y sin mirar el error; si RLS rechazaba el borrado, la
  // vista reaparecía al refrescar y nadie veía nada. Mismo confirm() que usa el resto del ERP
  // (bulk-bar.tsx); el error se enseña debajo en vez de tragarse.
  async function del(v: SavedView) {
    if (!window.confirm(t(`Delete the view "${v.name}"? This cannot be undone.`, `¿Borrar la vista "${v.name}"? No se puede deshacer.`))) return;
    setErr(null);
    const { error } = await createClient().from("saved_views").delete().eq("id", v.id);
    if (error) { setErr(t(`Could not delete "${v.name}": ${error.message}`, `No se pudo borrar "${v.name}": ${error.message}`)); return; }
    router.refresh();
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-slate-400">{t("Views", "Vistas")}</span>
      {builtins.map((b) => (
        <button
          key={b.name}
          type="button"
          onClick={() => onApply(b.state)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-600 hover:border-clay-300 hover:text-clay-700"
        >
          {b.name}
        </button>
      ))}
      {saved.map((v) => (
        <span
          key={v.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-clay-200 bg-clay-50 px-2.5 py-1 text-sm text-clay-700"
        >
          <button type="button" onClick={() => onApply(v.state)} className="hover:underline">
            {v.name}
          </button>
          <button type="button" onClick={() => rename(v)} title={t("Rename", "Renombrar")} className="text-clay-400 hover:text-clay-700">
            ✎
          </button>
          <button type="button" onClick={() => del(v)} title={t("Delete", "Borrar")} className="text-clay-400 hover:text-red-600">
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500 hover:border-clay-400 hover:text-clay-700 disabled:opacity-50"
      >
        {t("+ Save view", "+ Guardar vista")}
      </button>
      {err && <span role="alert" className="basis-full text-sm text-red-600">{err}</span>}
    </div>
  );
}
