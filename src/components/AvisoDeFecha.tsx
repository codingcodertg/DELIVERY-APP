import {
  cambiaLaFecha, esDomingo, problemaDeFecha, puedeAutorizarDomingo, textoDelProblema, type CasoEspecial,
} from "@/lib/dia-de-entrega";
import { AVISO_CORTE_VENTAS, pideConfirmarMediodia } from "@/lib/corte-de-ventas";

/**
 * El aviso debajo de un selector de fecha de entrega (D-658): «Los domingos no hay entregas» y, para oficina, gerente
 * y admin, la casilla «Caso especial: entregar en domingo» con su motivo. Un vendedor o un chofer leen «pídeselo a la
 * oficina», sin casilla. Una fecha con un año imposible lo dice aquí mismo. El selector nativo no deja marcar un día de
 * la semana como no disponible: por eso el aviso sale al elegirlo, y el guardado lo para (`problemaAlAgendar`).
 *
 * Sin estado propio: la casilla y el motivo los guarda quien lo monta, que es quien escribe la fecha y la nota.
 * Solo sale cuando la fecha es nueva o cambia, como el tope al guardar.
 *
 * Y a ventas, pasadas las 12 del mediodía en Texas, una fecha de hoy trae aquí mismo un consejo (en ámbar, sin casilla):
 * que se asegure de que es para hoy. No bloquea; al guardar se le pregunta una vez (`corte-de-ventas`).
 */
export function AvisoDeFecha({ fecha, actual, rol, caso, onCaso, t, hoy, ahora }: {
  fecha: string | null | undefined;
  actual: string | null | undefined;
  rol: string | null | undefined;
  caso: CasoEspecial;
  onCaso: (c: CasoEspecial) => void;
  t: (en: string, es: string) => string;
  /** Hoy en Texas (`todayISO()` si falta): decide los años posibles. */
  hoy?: string;
  /** El instante (`new Date()` si falta): decide el consejo de mediodía de ventas. Para fijarlo en las pruebas. */
  ahora?: Date;
}) {
  if (!cambiaLaFecha(fecha, actual)) return null;
  const imposible = problemaDeFecha(fecha, { hoy }) === "fecha_imposible";
  // El año imposible y el domingo se dicen antes: tienen su propio aviso (y el domingo, su casilla).
  if (!imposible && !esDomingo(fecha) && pideConfirmarMediodia(fecha, actual, { rol, ahora })) {
    return (
      <div data-aviso-fecha="corte-ventas" role="status"
        style={{ margin: "6px 0 12px", padding: "10px 12px", borderRadius: 8, background: "var(--amber-soft)", border: "1px solid var(--amber)", fontSize: 13, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>🕛 {t(AVISO_CORTE_VENTAS.en, AVISO_CORTE_VENTAS.es)}</div>
      </div>
    );
  }
  if (!imposible && !esDomingo(fecha)) return null;
  const autoriza = puedeAutorizarDomingo(rol);
  const aviso = textoDelProblema(imposible ? "fecha_imposible" : "domingo", rol, { hoy });
  return (
    <div data-aviso-fecha={imposible ? "imposible" : "domingo"} role="alert"
      style={{ margin: "6px 0 12px", padding: "10px 12px", borderRadius: 8, background: imposible ? "var(--red-soft)" : "var(--amber-soft)", border: `1px solid ${imposible ? "var(--red)" : "var(--amber)"}`, fontSize: 13, minWidth: 0 }}>
      <div style={{ fontWeight: 700 }}>{imposible ? "⚠ " : "🚫 "}{t(aviso.en, aviso.es)}</div>
      {!imposible && autoriza && (
        <>
          <label className="check" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, cursor: "pointer" }}>
            <input type="checkbox" data-caso-especial checked={caso.marcado} style={{ width: "auto" }}
              onChange={(e) => onCaso({ ...caso, marcado: e.target.checked })} />
            <span>{t("Special case: deliver on Sunday", "Caso especial: entregar en domingo")}</span>
          </label>
          {caso.marcado && (
            <input type="text" data-motivo-domingo value={caso.motivo} maxLength={120} autoFocus
              placeholder={t("Reason (short)", "Motivo (corto)")} aria-label={t("Reason for the Sunday delivery", "Motivo de la entrega en domingo")}
              onChange={(e) => onCaso({ ...caso, motivo: e.target.value })}
              style={{ marginTop: 6, width: "100%", boxSizing: "border-box" }} />
          )}
        </>
      )}
    </div>
  );
}
