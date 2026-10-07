"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CLAVE_TT, EVENTO_IDIOMA, idiomaDeRtgPrefs, sincronizaIdiomaAlCargar, type Idioma } from "@/lib/idioma";
import { CONSULTA_OSCURO, esPreferenciaDeTema, temaEfectivo, type PreferenciaDeTema, type Tema } from "@/lib/tema";

// ============================================================
// UI preferences: language (EN/ES) + theme (light/dark, or the device's — D-490).
// Theme: persisted to localStorage, applied to <html> via data-theme.
// Both are CHOSEN in one place only, the hub's «Personalizar» (/home/personalizar, D-490);
// every app just reads them from here.
// Language: ONE for every app, per person, in public.profiles.language (D-266).
// localStorage keeps a copy (rtg_prefs.lang, and tt_lang for Time Tracker) so the
// page paints in the right language before the network answers.
// ============================================================

export type Lang = Idioma;
export type Theme = Tema;

interface Prefs {
  lang: Lang;
  /** El tema que se está pintando ahora, ya resuelto: nunca `system`. */
  theme: Theme;
  /**
   * Lo que la persona eligió en el personalizador, `system` incluido (D-490). Sin elección guardada
   * es el tema efectivo, para que el personalizador marque lo que se ve.
   */
  themePref: PreferenciaDeTema;
  setLang: (l: Lang) => void;
  setTheme: (t: PreferenciaDeTema) => void;
  toggleLang: () => void;
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
function enEscritorio(): boolean {
  return typeof window !== "undefined" && !!window.ttDesktop?.isDesktop;
}
/** Si el sistema está en oscuro ahora mismo. Sin `matchMedia` (pruebas, navegadores viejos), no. */
function sistemaOscuro(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(CONSULTA_OSCURO).matches;
  } catch {
    return false;
  }
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
  // Lo ELEGIDO (null = nada guardado todavía) y lo que dice el sistema; el tema que se pinta sale de
  // los dos con `temaEfectivo`, la misma función que prueba el guion de antes de pintar.
  const [themeElegido, setThemeElegido] = useState<PreferenciaDeTema | null>(null);
  const [oscuroDelSistema, setOscuroDelSistema] = useState<boolean>(sistemaOscuro);
  const theme = temaEfectivo(themeElegido, { sistemaOscuro: oscuroDelSistema, escritorio: enEscritorio() });
  // De quién es la sesión, para guardar el idioma sin volver a preguntar.
  const usuario = useRef<string | null>(null);
  // ¿Ya se leyó lo guardado? Hasta entonces NO se pinta ni se guarda nada (D-490). Sin esta guarda,
  // el primer pintado guardaba los valores de arranque —inglés y claro— ENCIMA de lo elegido, antes
  // de que la lectura de arriba llegara a aplicarse; y si React rehacía el árbol justo entonces (lo
  // hace cuando el HTML del servidor no coincide, y Time Tracker en español no coincide nunca: su
  // diccionario no sabe el idioma en el servidor), la segunda lectura encontraba ya «en/light».
  // Medido el 2026-10-07 en el navegador: abrir Time Tracker con «es/dark» guardado lo dejaba en
  // «en/light», con el código de origin/main y con este, hasta poner la guarda.
  const [cargado, setCargado] = useState(false);

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
        const guardado = (p as { theme?: unknown }).theme;
        if (esPreferenciaDeTema(guardado)) setThemeElegido(guardado);
      }
    } catch {
      /* ignore */
    }
    setCargado(true);

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

  // «El del equipo» sigue al sistema EN VIVO: si el teléfono pasa a oscuro al anochecer, la app
  // también, sin recargar. Solo se escucha mientras esa es la elección.
  useEffect(() => {
    if (themeElegido !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(CONSULTA_OSCURO);
    const cambia = () => setOscuroDelSistema(mq.matches);
    cambia();
    mq.addEventListener?.("change", cambia);
    return () => mq.removeEventListener?.("change", cambia);
  }, [themeElegido]);

  // Apply + persist whenever they change. Se guarda lo ELEGIDO (`system` incluido), no lo resuelto:
  // si se guardara el resuelto, «el del equipo» se convertiría en «oscuro» la primera noche.
  useEffect(() => {
    // Antes de leer lo guardado, el guion de antes de pintar ya dejó `data-theme` y `lang` bien.
    if (!cargado) return;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("lang", lang);
    try {
      localStorage.setItem(KEY, JSON.stringify({ lang, theme: themeElegido ?? theme }));
    } catch {
      /* ignore */
    }
  }, [cargado, lang, theme, themeElegido]);

  /**
   * Elegir idioma. Desde D-490 se elige en UN sitio de la pantalla, el personalizador del hub
   * (antes también en «Mi perfil» y en el conmutador de cada barra), más la pantalla de contraseña
   * obligatoria. Todos llaman a esto, y esto escribe en UN sitio: es lo que impide que dos pantallas
   * guarden idiomas distintos.
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
  const setTheme = useCallback((t: PreferenciaDeTema) => setThemeElegido(t), []);
  // Sin `toggleTheme` desde D-490: el único que lo usaba era el 🌙 de la barra de Time Tracker, que
  // se fue al personalizador. `toggleLang` queda para la pantalla de contraseña obligatoria, que se
  // ve ANTES de poder entrar al hub (D-486) y es como el login.
  const toggleLang = useCallback(() => setLang(lang === "en" ? "es" : "en"), [lang, setLang]);
  const t = useCallback((en: string, es: string) => (lang === "es" ? es : en), [lang]);

  return (
    <Ctx.Provider value={{ lang, theme, themePref: themeElegido ?? theme, setLang, setTheme, toggleLang, t }}>
      {children}
    </Ctx.Provider>
  );
}
