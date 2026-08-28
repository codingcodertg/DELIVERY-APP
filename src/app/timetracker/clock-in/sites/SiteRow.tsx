"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import AddSiteForm, { type EditSite } from "./AddSiteForm";
import SiteToggle from "./SiteToggle";
import { t, type Lang } from "@/lib/clockin/i18n";

const BoundaryMap = dynamic(() => import("./BoundaryMap"), { ssr: false });

type Site = EditSite & { active: boolean };

export default function SiteRow({ site, lang }: { site: Site; lang: Lang }) {
  const tr = t(lang).mgr;
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState(false);
  const hasPoly = Array.isArray(site.boundary) && site.boundary.length >= 3;

  if (editing) {
    return (
      <li className="py-3 border-t border-zinc-100 dark:border-zinc-900 first:border-0">
        <AddSiteForm lang={lang} editSite={site} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-2.5 border-t border-zinc-100 dark:border-zinc-900 first:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className={site.active ? "" : "opacity-50"}>
          <span className="font-medium">{site.name}</span>
          {hasPoly && (
            <span className="ml-2 text-xs rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5">
              {tr.propertyOutlineBadge}
            </span>
          )}
          {!site.active && <span className="ml-2 text-xs text-red-500">{tr.inactive}</span>}
          <span className="block text-xs text-zinc-400 tabular-nums">
            {hasPoly
              ? `${site.boundary!.length} ${lang === "es" ? "esquinas" : "corners"} · ${site.padding_meters ?? 25} m ${lang === "es" ? "margen" : "padding"}`
              : `${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)} · ${site.radius_meters} m ${lang === "es" ? "radio" : "radius"}`}
          </span>
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => setViewing((v) => !v)} className="text-xs text-emerald-600 hover:underline font-medium">
            {viewing ? tr.hideMap : `🗺 ${tr.viewMap}`}
          </button>
          <button onClick={() => setEditing(true)} className="text-xs text-emerald-600 hover:underline font-medium">
            {tr.edit}
          </button>
          <SiteToggle id={site.id} active={site.active} lang={lang} />
        </div>
      </div>

      {viewing && (
        <div className="h-56 w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <BoundaryMap
            points={hasPoly ? (site.boundary as { lat: number; lng: number }[]) : []}
            center={{ lat: site.latitude, lng: site.longitude }}
            single={!hasPoly}
            onAdd={() => {}}
          />
        </div>
      )}
    </li>
  );
}
