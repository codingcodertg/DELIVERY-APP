"use client";

import {
  TIPOS_DE_TRABAJADOR, esTipoDeTrabajador, estadoDeFicha,
  type MitadTimeTracker, type TipoDeTrabajador,
} from "@/lib/timetracker/tipo-trabajador";

// ============================================================
// «Tipo de trabajador» en la ficha de Usuarios (D-NEXT).
//
// El dueño fue a Usuarios a poner a alguien como presencial y la opción no estaba: solo existía
// en Time Tracker › People. Aquí está el selector, con la frase que explica la diferencia, y
// —lo que de verdad confundía— el ESTADO de las dos mitades dicho en claro:
//
//   · qué tipo se le está aplicando hoy, lo haya elegido alguien o venga del defecto;
//   · si está activa en Time Tracker (People la pinta «Inactive» si no tiene fila);
//   · si su fichaje cuenta tiempo.
//
// Es solo dibujo: recibe lo leído y avisa de lo elegido. No importa acciones de servidor, y por
// eso se puede renderizar en una prueba (lo que ve un admin para una persona sin fila).
// Controles del hub (.field, .hint, .btn), como el resto de la ficha: aquí no hay Tailwind ni
// la hoja de Time Tracker.
// ============================================================

type T = (en: string, es: string) => string;

export const NOMBRE_DE_TIPO: Record<TipoDeTrabajador, { en: string; es: string }> = {
  inhouse: { en: "In-house (works at the store)", es: "Presencial (trabaja en la tienda)" },
  remote: { en: "Remote", es: "Remoto" },
};

export function TipoDeTrabajadorCampo({
  tt, fichaje, busy, t, onElegir, onActivar,
}: {
  tt: MitadTimeTracker;
  /** La mitad de fichaje; null = no tiene ficha de fichaje. */
  fichaje: { active: boolean } | null;
  busy: boolean;
  t: T;
  onElegir: (tipo: TipoDeTrabajador) => void;
  onActivar: () => void;
}) {
  const estado = estadoDeFicha(tt, fichaje);
  const nombre = (k: TipoDeTrabajador) => t(NOMBRE_DE_TIPO[k].en, NOMBRE_DE_TIPO[k].es);
  const verde = { color: "var(--green)" };
  const ambar = { color: "var(--amber-text)" };

  return (
    <div className="field" data-tipo={estado.tipo} data-elegido={estado.elegido ? "si" : "no"} data-tt={estado.timeTracker} data-fichaje={estado.fichaje}>
      <label>{t("Worker type", "Tipo de trabajador")}</label>

      {estado.timeTracker === "ilegible" ? (
        // Quien mira no es admin de Time Tracker: la base no le enseña la fila de otro, así que
        // no se afirma ni «presencial» ni «sin configurar». Se dice quién puede.
        <div className="hint" style={ambar}>
          ⚠ {t("Only a Time Tracker admin can see and change the worker type.",
               "Solo un admin de Time Tracker puede ver y cambiar el tipo de trabajador.")}
        </div>
      ) : (
        <select
          value={tt.workerType ?? ""}
          disabled={busy}
          onChange={(e) => { if (esTipoDeTrabajador(e.target.value)) onElegir(e.target.value); }}
        >
          {/* Solo mientras nadie eligió: dice qué se le está aplicando, en vez de dejar que
              «por defecto» pase por una elección. Una vez elegido, la opción desaparece. */}
          {!estado.elegido && (
            <option value="">
              {t(`Not chosen — counts as ${nombre(estado.tipo)}, the default`,
                 `Sin elegir — cuenta como ${nombre(estado.tipo)}, el valor por defecto`)}
            </option>
          )}
          {TIPOS_DE_TRABAJADOR.map((k) => <option key={k} value={k}>{nombre(k)}</option>)}
        </select>
      )}

      <div className="hint">
        {t("In-house clocks in and out at the store, with a photo and their location. Remote uses the timer, with screenshots.",
           "El presencial ficha entrada y salida en la tienda, con foto y ubicación. El remoto usa el cronómetro, con capturas de pantalla.")}
      </div>

      {estado.timeTracker !== "ilegible" && (
        <div className="hint">
          {t("Time Tracker:", "Time Tracker:")}{" "}
          {estado.timeTracker === "activo"
            ? <b style={verde}>{t("active", "activo")}</b>
            : <b style={ambar}>{t("inactive", "inactivo")}</b>}
          {" · "}
          {t("Store clock-in:", "Fichaje en tienda:")}{" "}
          {estado.fichaje === "activo" && <b style={verde}>{t("counting time", "contando tiempo")}</b>}
          {estado.fichaje === "detenido" && <b style={ambar}>{t("stopped", "detenido")}</b>}
          {estado.fichaje === "sin_fila" && <b style={ambar}>{t("not set up", "sin ficha")}</b>}
        </div>
      )}

      {estado.timeTracker === "sin_fila" && (
        <div className="hint" style={ambar}>
          ⚠ {t(
            `Nobody has set this person up in Time Tracker yet: they show as Inactive in Time Tracker › People and count as ${nombre(estado.tipo)}. Pick the type above — that sets them up and activates them.`,
            `Nadie ha configurado a esta persona en Time Tracker: sale como Inactiva en Time Tracker › People y cuenta como ${nombre(estado.tipo)}. Elige el tipo arriba — eso la configura y la activa.`,
          )}
        </div>
      )}

      {estado.timeTracker === "apagado" && (
        <div className="hint" style={ambar}>
          ⚠ {t("Shows as Inactive in Time Tracker › People.", "Sale como Inactiva en Time Tracker › People.")}{" "}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onActivar}>
            {t("Activate", "Activar")}
          </button>
        </div>
      )}
    </div>
  );
}
