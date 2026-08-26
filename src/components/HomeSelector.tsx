"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { VersionFooter } from "@/components/VersionFooter";
import { accessibleModules, HUB_TOOLS, roleHome } from "@/lib/constants";
import type { Profile } from "@/lib/types";

/** Reached by someone with 2+ modules, OR with a hub tool visible to them
 * (D-056) — see src/app/home/page.tsx for the exact gate. */
export function HomeSelector({ me }: { me: Profile }) {
  const { lang, t } = usePrefs();
  const available = accessibleModules(me.module_access);
  const tools = HUB_TOOLS.filter((tool) => tool.visible(me));
  // The deliveries card's own href is a placeholder ("/") — it's the same
  // ModuleInfo entry used by the app switcher and everywhere else, but where
  // deliveries actually lands depends on the person's role (warehouse -> its
  // own queue, logistics -> routes, not the Orders board everyone else gets).
  const hrefFor = (key: string, fallback: string) => (key === "deliveries" ? roleHome(me.role) : fallback);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <h1>
          {t("Hi, ", "Hola, ")}
          {me.full_name}
        </h1>
        <p style={{ color: "var(--ink-soft)", marginBottom: 20 }}>
          {t("Which one do you want to open?", "¿Cuál quieres abrir?")}
        </p>
        <div className="module-pick-grid">
          {available.map((m) => (
            <Link key={m.key} href={hrefFor(m.key, m.href)} className="module-pick-card">
              <span className="module-pick-emoji">{m.emoji}</span>
              <span className="module-pick-label">{lang === "es" ? m.label_es : m.label_en}</span>
              <span className="module-pick-desc">{lang === "es" ? m.desc_es : m.desc_en}</span>
            </Link>
          ))}
        </div>

        {/* A tool isn't a module — it doesn't get the same big launch tile. */}
        {tools.length > 0 && (
          <>
            <div className="hub-tools-label">{t("Tools", "Herramientas")}</div>
            {tools.map((tool) => (
              <Link key={tool.key} href={tool.href} className="hub-tool-row">
                <span className="hub-tool-emoji">{tool.emoji}</span>
                <span>
                  <span className="hub-tool-label">{lang === "es" ? tool.label_es : tool.label_en}</span>
                  <span className="hub-tool-desc" style={{ display: "block" }}>{lang === "es" ? tool.desc_es : tool.desc_en}</span>
                </span>
              </Link>
            ))}
          </>
        )}

        {/* Signing out from the hub. Every module's own topbar has this, but the hub sits
            above all of them — without it, leaving meant entering an app you did not want
            just to reach its Sign out. Same POST to /auth/signout the topbars use. */}
        <form action="/auth/signout" method="post" className="hub-signout">
          <button type="submit" className="hub-signout-btn">
            {t("Sign out", "Salir")}
          </button>
        </form>
      </div>
      <VersionFooter fixed />
    </div>
  );
}
