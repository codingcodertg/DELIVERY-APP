"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CLAVE_TT, EVENTO_IDIOMA, idiomaDeRtgPrefs, sincronizaIdiomaAlCargar, type Idioma } from "@/lib/idioma";

// ============================================================
// UI preferences: language (EN/ES) + theme (light/dark).
// Theme: persisted to localStorage, applied to <html> via data-theme.
// Language: ONE for every app, per person, in public.profiles.language (D-266).
// localStorage keeps a copy (rtg_prefs.lang, and tt_lang for Time Tracker) so the
// page paints in the right language before the network answers.
// ============================================================

export type Lang = Idioma;
export type Theme = "light" | "dark";

interface Prefs {
  lang: Lang;
  theme: Theme;
  setLang: (l: Lang) => void;
  setTheme: (t: Theme) => void;
  toggleLang: () => void;
  toggleTheme: () => void;
  /** Pick the string for the current language. */
  t: (en: string, es: string) => string;
}

const Ctx = createContext<Prefs | null>(null);
const KEY = "rtg_prefs";
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export function usePrefs(): Prefs {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}

// The timetracker desktop shell (window.ttDesktop) has no explicit
// preference the first time it ever runs — default it to dark (D-080),
// matching layout.tsx's inline pre-paint script. Everyone else still
// defaults to light, unchanged. Read once, lazily, so this only ever
// matters for the very first render before localStorage is checked below.
function defaultTheme(): Theme {
  return typeof window !== "undefined" && window.ttDesktop?.isDesktop ? "dark" : "light";
}

/**
 * Las copias locales del idioma, al día. Time Tracker lee `tt_lang` al arrancar y escucha el evento
 * para cambiar sin recargar. Se avisa así y no importando su diccionario aquí: este proveedor está
 * en todas las páginas, y el diccionario de Time Tracker entraría entero en todas las apps.
 */
function copiaLocal(l: Lang) {
  try {
    localStorage.setItem(CLAVE_TT, l);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_IDIOMA, { detail: l }));
  } catch {
    /* ignore */
  }
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  // De quién es la sesión, para guardar el idioma sin volver a preguntar.
  const usuario = useRef<string | null>(null);

  // Load saved prefs on mount.
  useEffect(() => {
    let raw: string | null = null;
    let tt: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
      tt = localStorage.getItem(CLAVE_TT);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Prefs>;
        if (p.lang === "en" || p.lang === "es") setLangState(p.lang);
        if (p.theme === "light" || p.theme === "dark") setThemeState(p.theme);
      }
    } catch {
      /* ignore */
    }

    // Y el idioma de la persona, de la base. Sin sesión (el login) o en modo local no hay a quién
    // preguntar, y la copia local de arriba es lo que había siempre.
    if (LOCAL_MODE) return;
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      if (!vivo || !uid) return;
      usuario.current = uid;
      // La regla (base, copias locales, cuándo se siembra, qué pasa si la lectura falla) está en
      // `lib/idioma.ts` y se prueba allí con datos. Aquí solo se le da Supabase y cómo aplicar.
      await sincronizaIdiomaAlCargar({
        uid,
        hub: idiomaDeRtgPrefs(raw),
        tt,
        leerDeLaBase: async (id) => await supabase.from("profiles").select("language").eq("id", id).maybeSingle(),
        // Los avisos de fichaje, de la vista: con profiles.language vacía, es el de employee_settings.
        leerAvisos: async (id) => await supabase.schema("clockin").from("profiles").select("language").eq("id", id).maybeSingle(),
        guardarEnLaBase: async (id, l) => await supabase.from("profiles").update({ language: l }).eq("id", id),
        aplicar: (l) => {
          if (!vivo) return;
          setLangState(l);
          copiaLocal(l);
        },
      });
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Apply + persist whenever they change.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("lang", lang);
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang, theme }));
    } catch {
      /* ignore */
    }
  }, [lang, theme]);

  /**
   * Elegir idioma, desde donde sea: «Mi perfil», el conmutador de cada barra o la cuenta de Entregas.
   * Todos llaman a esto, y esto escribe en UN sitio. Es lo que impide que dos pantallas guarden
   * idiomas distintos.
   */
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    copiaLocal(l);
    if (LOCAL_MODE) return;
    void (async () => {
      const supabase = createClient();
      let uid = usuario.current;
      if (!uid) {
        const { data: { session } } = await supabase.auth.getSession();
        uid = session?.user?.id ?? null;
      }
      if (!uid) return;
      await supabase.from("profiles").update({ language: l }).eq("id", uid);
    })();
  }, []);
  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleLang = useCallback(() => setLang(lang === "en" ? "es" : "en"), [lang, setLang]);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === "light" ? "dark" : "light")), []);
  const t = useCallback((en: string, es: string) => (lang === "es" ? es : en), [lang]);

  return (
    <Ctx.Provider value={{ lang, theme, setLang, setTheme, toggleLang, toggleTheme, t }}>
      {children}
    </Ctx.Provider>
  );
}
