"use client";

import Link from "next/link";
import { usePrefs } from "@/lib/prefs";
import { OPCIONES_DE_IDIOMA, OPCIONES_DE_TEMA } from "@/lib/personalizar";

/**
 * «Personalizar» (D-490): el único sitio donde se eligen el idioma y el tema de todas las apps.
 *
 * Las opciones salen de `lib/personalizar.ts` y se guardan por el proveedor de siempre (`usePrefs`):
 * el idioma en la base, por persona (D-266), y el tema en este equipo (`lib/tema.ts`). Entregas, Time
 * Tracker, RR. HH., el ERP, Quote Builder, Leads, Encuestas y Promociones leen los dos de ahí; ninguna
 * barra tiene ya su propio botón.
 *
 * Cada grupo es un `radiogroup`: se ve cuál está puesto sin tener que adivinarlo por el color.
 */
export function Personalizador() {
  const { t, lang, setLang, themePref, setTheme } = usePrefs();

  return (
    <>
      <div className="page-head">
        <h2>🎨 {t("Customize", "Personalizar")}</h2>
        <Link href="/home" className="btn btn-ghost btn-sm">{t("Back to hub", "Volver al hub")}</Link>
      </div>
      <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
        {t(
          "How every app in the hub looks for you: Deliveries, Time Tracker, HR, ERP, Quote Builder, Leads and Surveys.",
          "Cómo se ven para ti todas las apps del hub: Entregas, Time Tracker, RR. HH., ERP, Quote Builder, Leads y Encuestas.",
        )}
      </p>

      <div className="card" data-personalizar="idioma">
        <h2>{t("Language", "Idioma")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          {t(
            "Every app and every notification, on every device you sign in to.",
            "Todas las apps y todos los avisos, en cualquier equipo en el que entres.",
          )}
        </p>
        <div className="pers-opciones" role="radiogroup" aria-label={t("Language", "Idioma")}>
          {OPCIONES_DE_IDIOMA.map((o) => (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={lang === o.valor}
              className={"pers-opcion" + (lang === o.valor ? " on" : "")}
              onClick={() => setLang(o.valor)}
            >
              <span aria-hidden>{o.emoji}</span> {lang === "es" ? o.es : o.en}
            </button>
          ))}
        </div>
      </div>

      <div className="card" data-personalizar="tema">
        <h2>{t("Theme", "Tema")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
          {t(
            "Applies to every app, on this device. «Same as my device» follows your phone or computer, day and night.",
            "Vale para todas las apps, en este equipo. «Como mi equipo» sigue a tu teléfono o tu computadora, de día y de noche.",
          )}
        </p>
        <div className="pers-opciones" role="radiogroup" aria-label={t("Theme", "Tema")}>
          {OPCIONES_DE_TEMA.map((o) => (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={themePref === o.valor}
              className={"pers-opcion" + (themePref === o.valor ? " on" : "")}
              onClick={() => setTheme(o.valor)}
            >
              <span aria-hidden>{o.emoji}</span> {lang === "es" ? o.es : o.en}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
