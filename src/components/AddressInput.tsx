"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { AVISO_SOLO_CIUDAD, esSoloCiudad } from "@/lib/solo-ciudad";
import { LRUSugerencias, nuevaSesionDeAutocompletado } from "@/lib/autocompletado-cache";

// Espera tras el último tecleo antes de preguntar (ms). Cada pregunta de Places se factura: menos preguntas, menos coste.
const ESPERA_MS = 500;
// Caché por pestaña (módulo): texto ya preguntado → sugerencias. Lo que ya salió no vuelve a la red en esta pestaña.
const sugerenciasYaPedidas = new LRUSugerencias<string[]>(50);

// ============================================================
// Text input with real-time address autocomplete. As the user types (3+ chars),
// it queries /api/geocode (debounced) and shows a dropdown of suggestions.
// Picking one sets the value — which the order form uses to recompute mileage.
// Free-typing still works; suggestions are best-effort and need internet.
//
// The suggestions dropdown only opens in response to the user actually
// typing here. Any other way the value changes — picking a suggestion,
// picking a saved site, an auto-filled map pin, a parent-level reset —
// must never reopen it; that field already holds a "system ready" address.
// ============================================================

export function AddressInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Highlight as a missing required field. */
  invalid?: boolean;
}) {
  const { t } = usePrefs();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Set synchronously by the input's own onChange, right before the value
  // prop changes — the one signal that this change was the user typing.
  const userEdited = useRef(false);
  // Token de sesión de Google Places: uno por ratos de escritura (al entrar al campo y tras elegir una sugerencia).
  const sesion = useRef<string | null>(null);

  const text = value ?? "";

  // Debounced lookup — but only for changes the user actually typed.
  useEffect(() => {
    if (disabled) return;
    if (!userEdited.current) { setSuggestions([]); setOpen(false); return; }
    userEdited.current = false;
    const q = text.trim();
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    const clave = q.toLowerCase();
    const yaPedidas = sugerenciasYaPedidas.get(clave);
    if (yaPedidas) {
      // Ya preguntado en esta pestaña: se enseña sin red y sin esperar.
      setSuggestions(yaPedidas);
      setOpen(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        if (!sesion.current) sesion.current = nuevaSesionDeAutocompletado();
        const res = await fetch(`/api/geocode?session=${encodeURIComponent(sesion.current)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q }),
        });
        const body = await res.json();
        const lista: string[] = Array.isArray(body.suggestions) ? body.suggestions : [];
        // Solo se guarda lo que trajo algo: una respuesta vacía puede ser un fallo pasajero del proveedor.
        if (lista.length) sugerenciasYaPedidas.set(clave, lista);
        setSuggestions(lista);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, ESPERA_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, disabled]);

  // Close the dropdown when clicking away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (s: string) => {
    onChange(s);
    setSuggestions([]);
    setOpen(false);
    // Tras una elección empieza una sesión nueva: lo siguiente que se teclee es otra búsqueda.
    sesion.current = nuevaSesionDeAutocompletado();
  };

  return (
    <div className="field addr-field" ref={wrap}>
      <label>{label}{invalid && <span className="req-star"> *</span>}</label>
      <input
        className={invalid ? "invalid" : ""}
        type="text"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => { sesion.current = nuevaSesionDeAutocompletado(); }}
        onChange={(e) => { userEdited.current = true; onChange(e.target.value); }}
      />
      {loading && <span className="addr-spin" />}
      {open && suggestions.length > 0 && (
        <div className="addr-menu">
          {suggestions.map((s, i) => (
            <button type="button" key={i} className="addr-opt" onClick={() => pick(s)}>
              {/* Una ciudad a secas es la respuesta amplia (D-454): se puede elegir, y se dice qué es antes de elegirla. */}
              {esSoloCiudad(s)
                ? <>🏙️ {s} <span className="hint" data-sugerencia-ciudad> · {t(AVISO_SOLO_CIUDAD.en, AVISO_SOLO_CIUDAD.es)}</span></>
                : <>📍 {s}</>}
            </button>
          ))}
        </div>
      )}
      {/* Y una vez elegida (o tecleada), el aviso se queda bajo el campo: en la ficha de la orden y en el Quote Builder. */}
      {esSoloCiudad(text) && (
        <div className="hint" data-solo-ciudad style={{ color: "var(--amber-text)", fontWeight: 700, marginTop: 4 }}>
          ⚠ {t(AVISO_SOLO_CIUDAD.en, AVISO_SOLO_CIUDAD.es)}
        </div>
      )}
    </div>
  );
}
