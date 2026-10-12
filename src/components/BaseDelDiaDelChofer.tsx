"use client";

import { opcionesDeFin, opcionesDeSalida, type BaseDelDia, type ExtremosDelChofer } from "@/lib/base-del-dia";
import type { NamedLocation } from "@/lib/types";

/**
 * «Sale de: [RDZ Pharr ▾] · Termina en: [RDZ Pharr ▾]» de un chofer, para el día que se mira (165; reglas en
 * `base-del-dia.ts`). Va en su fila del panel «Choferes y rutas». En el Gestor, para el gerente de logística y el admin,
 * con dos selectores; en «Ruta de hoy» (D-481), solo se lee.
 *
 * Lo elegido para ESE día sale resaltado (y dice cuál es su base); lo de siempre, no. Pulsar aquí no enfoca la ruta: el clic
 * no sube a la fila.
 */
export function BaseDelDiaDelChofer(props: {
  t: (en: string, es: string) => string;
  extremos: ExtremosDelChofer;
  tiendas: readonly NamedLocation[];
  /** Con selectores (el Gestor, admin o logística). Sin esto, solo se lee. */
  editable: boolean;
  /** Por qué no se puede cambiar ahora (la 165 sin aplicar, un fallo, guardando…), ya en el idioma de quien mira. */
  apagado?: string | null;
  onCambia?: (cambio: Partial<BaseDelDia>) => void;
}) {
  const { t, extremos } = props;
  const { salida, fin, base } = extremos;
  const elegidaLaSalida = salida?.origen === "dia", elegidoElFin = fin?.origen === "dia";
  const suBase = base ? t(`Their base: ${base.tienda.name}`, `Su base: ${base.tienda.name}`) : t("No base store", "Sin tienda base");
  const resaltada = { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 700 } as const;
  const estiloDelSelector = { fontSize: 11, padding: "1px 2px", maxWidth: 175, minWidth: 0 } as const;
  // Las etiquetas de la app van en mayúsculas y en bloque (globals.css); aquí, en línea y como texto normal.
  const estiloDeEtiqueta = { display: "inline-flex", alignItems: "center", gap: 4, minWidth: 0, margin: 0, textTransform: "none", letterSpacing: "normal", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" } as const;

  if (!props.editable) {
    if (!salida) return null;
    return (
      <div data-base-del-dia="lectura" className="hint" style={{ marginTop: 3, fontSize: 11, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span data-sale-de-texto title={elegidaLaSalida ? suBase : undefined} style={elegidaLaSalida ? { color: "var(--accent)", fontWeight: 700 } : undefined}>
          🏠 {t("Starts at", "Sale de")} {salida.tienda.name}
        </span>
        <span data-termina-en-texto title={elegidoElFin ? suBase : undefined} style={elegidoElFin ? { color: "var(--accent)", fontWeight: 700 } : undefined}>
          · {fin ? `${t("Ends at", "Termina en")} ${fin.tienda.name}` : t("doesn't return to base", "no vuelve a base")}
        </span>
      </div>
    );
  }

  const apagado = !!props.apagado;
  return (
    <div data-base-del-dia="selector" onClick={(e) => e.stopPropagation()} style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 11 }}
      title={props.apagado ?? undefined}>
      <label style={estiloDeEtiqueta}>
        🏠 {t("Starts at", "Sale de")}
        <select data-sale-de value={elegidaLaSalida ? salida!.tienda.name : ""} disabled={apagado}
          title={elegidaLaSalida ? t(`Changed for this day only. ${suBase}.`, `Cambiada solo para este día. ${suBase}.`) : t("Where the truck leaves from this day (default: their base)", "De dónde sale el camión este día (por defecto, su base)")}
          onChange={(e) => props.onCambia?.({ salida: e.target.value || null })}
          style={{ ...estiloDelSelector, ...(elegidaLaSalida ? resaltada : {}) }}>
          {opcionesDeSalida(props.tiendas, base?.tienda ?? null).map((o) => <option key={o.valor || "·"} value={o.valor} disabled={o.apagada}>{t(o.en, o.es)}</option>)}
        </select>
      </label>
      <label style={estiloDeEtiqueta}>
        {t("Ends at", "Termina en")}
        {fin || !salida ? (
          <select data-termina-en value={elegidoElFin ? fin!.tienda.name : ""} disabled={apagado || !salida}
            title={elegidoElFin ? t(`Changed for this day only. ${suBase}.`, `Cambiado solo para este día. ${suBase}.`) : t("Where the truck ends the day (default: where it starts)", "Dónde termina el día el camión (por defecto, donde sale)")}
            onChange={(e) => props.onCambia?.({ fin: e.target.value || null })}
            style={{ ...estiloDelSelector, ...(elegidoElFin ? resaltada : {}) }}>
            {opcionesDeFin(props.tiendas, salida?.tienda ?? null, base?.tienda ?? null).map((o) => <option key={o.valor || "·"} value={o.valor} disabled={o.apagada}>{t(o.en, o.es)}</option>)}
          </select>
        ) : (
          <span data-no-vuelve className="hint" style={{ margin: 0 }}
            title={t("Settings → Routes: this driver doesn't return to base, so the route ends at the last stop.", "Ajustes → Rutas: este chofer no vuelve a base; la ruta acaba en su última parada.")}>
            {t("doesn't return", "no vuelve")}
          </span>
        )}
      </label>
    </div>
  );
}
