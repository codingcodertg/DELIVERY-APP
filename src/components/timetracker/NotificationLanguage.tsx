"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMyLanguage, setLanguage } from "@/app/timetracker/clock-in/actions/account";
import { useT } from "@/lib/timetracker/i18n";

/**
 * El idioma en el que llegan los avisos de fichaje, dentro de Mi cuenta.
 *
 * Era lo único que la pantalla de cuenta de fichaje tenía y esta no — lo demás (contraseña)
 * ya estaba aquí, duplicado. Con esto, `/timetracker/clock-in/account` deja de existir y hay
 * una sola pantalla donde alguien cambia sus cosas, en vez de dos que hacen media cada una.
 *
 * Es una reescritura y no una mudanza del componente de fichaje, por lo mismo que en D-095:
 * aquel es Tailwind y aquí se dibuja desde globals.css. La acción de servidor detrás sí es la
 * misma, así que no hay dos formas de guardar el mismo campo.
 *
 * **No es el idioma de la interfaz.** Ese lo elige cada quien en su navegador y no se guarda
 * en la base. Este es el de los avisos que manda el servidor —recordatorios de turno, partes
 * pendientes— que se escriben antes de que haya ninguna pantalla delante. Merecía decirse en
 * la propia pantalla, porque "Idioma" a secas hace pensar que cambia lo que estás mirando.
 *
 * D-206: sus cuatro textos, que estaban en inglés a pelo, pasan a claves emp.acc.notifLang* (vive
 * en Mi cuenta). "English" / "Español" son los nombres de cada idioma en su propio idioma: dato.
 */
export function NotificationLanguage() {
  const router = useRouter();
  const t = useT();
  // Se lee tras montar: este dato no está en el proveedor de Time Tracker y pedirlo al
  // servidor en el render rompería la hidratación.
  const [lang, setLang] = useState<"en" | "es">("en");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { void getMyLanguage().then((l) => { setLang(l); setLoaded(true); }); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function pick(next: "en" | "es") {
    if (next === lang || busy) return;
    const before = lang;
    setLang(next); // optimista: el desplegable no debe quedarse pegado esperando al servidor
    setBusy(true);
    setErr(null);
    const res = await setLanguage(next);
    setBusy(false);
    if (!res.ok) {
      setLang(before);
      setErr(res.message ?? t("emp.acc.notifLangFail"));
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <div className="field" style={{ maxWidth: 260 }}>
      <label>{t("emp.acc.notifLang")}</label>
      <select value={lang} disabled={busy || !loaded} onChange={(e) => pick(e.target.value as "en" | "es")}>
        <option value="en">English</option>
        <option value="es">Español</option>
      </select>
      <div className="hint">
        {t("emp.acc.notifLangNote")}
      </div>
      {saved && <div className="hint" style={{ color: "var(--green)" }}>{t("emp.acc.notifLangSaved")}</div>}
      {err && <div className="hint" style={{ color: "var(--red)" }}>{err}</div>}
    </div>
  );
}
