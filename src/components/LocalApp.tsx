"use client";

import { useEffect, useState } from "react";
import { LocalDataProvider, resetLocalData } from "@/lib/local-data-provider";
import { TopBar } from "@/components/TopBar";
import { VersionFooter } from "@/components/VersionFooter";
import { HelpButton } from "@/components/HelpButton";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ROLE_ORDER, roleLabel } from "@/lib/constants";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import type { Profile, UserRole } from "@/lib/types";

const ME_KEY = "rtg_deliveries_local_me";

/** Client-only app shell for LOCAL DEMO MODE. Owns the "current user" (with a
 * role switcher so you can test every role) and mounts the localStorage-backed
 * data provider. No Supabase, no login server. */
export function LocalApp({ children }: { children: React.ReactNode }) {
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [me, setMe] = useState<Profile>({ id: "u-admin", full_name: "You (Admin)", role: "admin" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ME_KEY);
      if (raw) setMe(JSON.parse(raw));
    } catch { /* ignore */ }
    setLoaded(true);
  }, []);

  const update = (patch: Partial<Profile>) => {
    const next = { ...me, ...patch };
    setMe(next);
    localStorage.setItem(ME_KEY, JSON.stringify(next));
  };

  if (!loaded) return null;

  return (
    <LocalDataProvider me={me}>
      <div className="local-banner no-print">
        <span className="lb-tag">{t("LOCAL DEMO", "DEMO LOCAL")}</span>
        <span className="lb-text">{t("Data is saved in this browser only — no server.", "Los datos se guardan solo en este navegador — sin servidor.")}</span>
        <span style={{ flex: 1 }} />
        <label className="lb-lbl">{t("View as", "Ver como")}</label>
        <select
          value={me.role}
          onChange={(e) => {
            const role = e.target.value as UserRole;
            // Switch to the matching demo identity (id + name + store), so role-targeted
            // notifications and store-scoping behave correctly as you switch perspectives.
            const preset = { admin: "You (Admin)", manager: "Maria Manager", accounting: "Olivia Office", logistics: "Laura Logistics", sales: "Sam Sales", warehouse: "Wade Warehouse", driver: "Diego Driver" }[role];
            const id = { admin: "u-admin", manager: "u-mgr", accounting: "u-acct", logistics: "u-log", sales: "u-sales", warehouse: "u-wh", driver: "u-drv" }[role];
            const store = { admin: null, manager: null, accounting: null, logistics: null, sales: null, warehouse: "McAllen", driver: "McAllen" }[role as string] as string | null;
            update({ id, role, full_name: preset, store });
          }}
        >
          {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
        </select>
        <button className="btn btn-sm btn-ghost" onClick={async () => {
          if (await confirmAction(
            t("Reset all demo data back to the starting sample?", "¿Restablecer los datos demo a la muestra inicial?"),
            { danger: true, confirmLabel: t("Reset", "Restablecer") },
          )) resetLocalData();
        }}>
          {t("Reset data", "Restablecer")}
        </button>
      </div>
      <TopBar me={me} />
      <div className="wrap"><ErrorBoundary role={me.role}>{children}</ErrorBoundary></div>
      <HelpButton me={me} />
      <VersionFooter />
    </LocalDataProvider>
  );
}
