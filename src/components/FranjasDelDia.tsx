import { textoDelMotivo, type MotivoDeAprobacion } from "@/lib/aprobacion-por-hora-y-cupo";
import { nombreDeFranja, textoDeFranja, type Franja } from "@/lib/franjas-del-dia";

/**
 * La tarjeta «Franjas de ese día» de la ficha de la orden (D-657): una casilla por franja con lo que queda, y pulsarla
 * la pone como ventana de la orden. Sin estado propio: todo llega hecho de `franjasDelDia`, y la ficha decide si
 * elegir cambia algo de la aprobación (`vaAAprobacion`), porque eso depende de quién crea y de la tienda.
 *
 * `onElige` nulo = solo mirar (ventas cambiando solo la fecha de una orden ya enviada, D-480: la ventana no se toca).
 */
export function FranjasDelDia({ franjas, actual, onElige, vaAAprobacion, tiendaFuera, es }: {
  franjas: Franja[];
  actual: string | null | undefined;
  onElige: ((ventana: string) => void) | null;
  vaAAprobacion: (motivos: MotivoDeAprobacion[]) => boolean;
  /** La tienda de la orden no cuenta para el cupo (flota propia): se dice, para que «Libre» no parezca un error. */
  tiendaFuera: string | null;
  es: boolean;
}) {
  if (!franjas.length) return null;
  // La hora de corte no es de una franja sino del día (o de su mañana): se dice una vez, debajo, con el texto de D-639.
  const cortes = new Map<string, string>();
  for (const f of franjas) {
    for (const m of f.motivos) {
      if (m.tipo !== "cupo" && vaAAprobacion(f.motivos)) cortes.set(m.tipo, textoDelMotivo(m, es));
    }
  }
  return (
    <div className="card" data-franjas-del-dia style={{ marginTop: 10, marginBottom: 12, padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>🕒 {es ? "Franjas de ese día" : "Time slots for that day"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6, marginTop: 8 }}>
        {franjas.map((f) => {
          const elegida = f.ventana === (actual ?? "");
          const llena = f.estado.tipo === "llena";
          const aprobacion = vaAAprobacion(f.motivos);
          return (
            <button
              key={f.ventana}
              type="button"
              data-franja={f.ventana}
              data-estado={f.estado.tipo}
              aria-pressed={elegida}
              disabled={!onElige}
              onClick={onElige ? () => onElige(f.ventana) : undefined}
              style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, textAlign: "left", minWidth: 0,
                padding: "7px 10px", borderRadius: 8, cursor: onElige ? "pointer" : "default", font: "inherit",
                border: `${elegida ? 2 : 1}px solid ${elegida ? "var(--accent)" : llena ? "var(--red-chip-line)" : "var(--line)"}`,
                background: elegida ? "var(--accent-soft)" : llena ? "var(--red-chip-bg)" : "var(--card)",
                color: "var(--text)",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 12, overflowWrap: "anywhere" }}>{nombreDeFranja(f.ventana, es)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: llena ? "var(--red-chip-text)" : f.estado.tipo === "quedan" ? "var(--green)" : "var(--ink-soft)" }}>
                {textoDeFranja(f.estado, es)}
              </span>
              {aprobacion && (
                <span data-va-a-aprobacion style={{ fontSize: 11, color: "var(--amber-text)" }}>
                  {es ? "→ va a aprobación de oficina" : "→ needs office approval"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {[...cortes.values()].map((txt) => (
        <div key={txt} className="hint" data-corte style={{ marginTop: 8, color: "var(--amber-text)" }}>
          ⏳ {txt}. {es ? "Esas franjas van a aprobación de oficina." : "Those slots need office approval."}
        </div>
      ))}
      {tiendaFuera && (
        <div className="hint" style={{ marginTop: 8 }}>
          {es ? `${tiendaFuera} no cuenta para el cupo de la mañana.` : `${tiendaFuera} doesn't count toward the morning limit.`}
        </div>
      )}
    </div>
  );
}
