"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { DRAFTS } from "@/lib/app-draft/drafts";

/** Inicio de App Draft: la rejilla de prototipos. */
export default function AppDraftHome() {
  const { t } = usePrefs();
  return (
    <main className="adr">
      <h1 className="adr-titulo">🧪 App Draft</h1>
      <p className="adr-sub">
        {t("Prototypes to show before deciding what to build for real. Each one runs on sample data — nothing here touches real data.",
          "Prototipos para enseñar antes de decidir qué construir de verdad. Cada uno usa datos de ejemplo: nada aquí toca datos reales.")}
      </p>
      <div className="adr-rejilla">
        {DRAFTS.map((d) => {
          const cuerpo = (
            <>
              <span className="adr-tarjeta-emoji" aria-hidden>{d.emoji}</span>
              <span className="adr-tarjeta-nombre">{t(d.nombre_en, d.nombre_es)}</span>
              <span className="adr-tarjeta-desc">{t(d.desc_en, d.desc_es)}</span>
              {d.listo
                ? <span className="adr-nota">{t("Prototype with sample data — nothing here touches real data", "Prototipo con datos de ejemplo: nada aquí toca datos reales")}</span>
                : <span className="badge adr-pronto">{t("Coming later", "Más adelante")}</span>}
            </>
          );
          return d.listo
            ? <Link key={d.ruta} href={`/app-draft/${d.ruta}`} className="adr-tarjeta" data-draft={d.ruta}>{cuerpo}</Link>
            : <div key={d.ruta} className="adr-tarjeta adr-tarjeta-apagada" aria-disabled="true">{cuerpo}</div>;
        })}
      </div>
    </main>
  );
}
