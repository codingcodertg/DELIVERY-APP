"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";

/**
 * Un campo de contraseña con el ojo para ver lo que se escribe (D-271).
 *
 * El dueño: «al cambiar la contraseña, pon el ojo para ver el texto, porque no me deja». El login ya
 * lo tenía; «Mi perfil» y la pantalla de restablecer, no. Ahora los cinco campos de contraseña de la
 * app son este componente, así que hay **una sola implementación** del ojo.
 *
 * **Un ojo por campo**, no uno para todos. En un teléfono el botón queda junto al dedo que está
 * escribiendo, y cada campo se enseña solo cuando su dueño lo pide: un único interruptor para los tres
 * campos de «Mi perfil» enseñaría la contraseña actual mientras se teclea la nueva, a la vista de quien
 * esté al lado.
 *
 * El botón dice lo que hace en los dos idiomas, como título y como `aria-label`, y marca su estado con
 * `aria-pressed`: un lector de pantalla no ve el emoji.
 *
 * **Sin nada sugerido dentro** (D-388). El campo traía ocho puntos de ejemplo y el dueño: «el sugerido
 * de los dots confunde, como si ya hubiese algo». Un campo de contraseña vacío tiene que verse vacío.
 */
export function PasswordInput({
  value, onChange, onKeyDown, placeholder = "", autoComplete, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const { t } = usePrefs();
  const [visible, setVisible] = useState(false);
  const etiqueta = visible ? t("Hide password", "Ocultar contraseña") : t("Show password", "Mostrar contraseña");

  return (
    <div style={{ position: "relative" }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        style={{ paddingRight: 40 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        title={etiqueta}
        aria-label={etiqueta}
        aria-pressed={visible}
        style={{
          position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
          width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 6, color: "var(--gray)", fontSize: 15,
        }}
      >
        {visible ? "🙈" : "👁"}
      </button>
    </div>
  );
}
