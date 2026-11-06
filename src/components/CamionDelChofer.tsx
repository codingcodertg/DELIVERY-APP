"use client";

import { useRef, useState } from "react";
import { useCierraAlSalir } from "@/lib/menu-desplegable";
import type { CamionAsignado, CamionElegible, ConflictoDeCamion, ResultadoDeAsignar } from "@/lib/tracksolid/useCamionDelDia";

type T = (en: string, es: string) => string;

/**
 * «🚛 EDINBURG PETERBIL» en la cabecera de la ruta de un chofer (D-903): el camión que lleva ESE día.
 *
 * Quien planifica rutas lo pulsa y elige en una ventanita, en el sitio: su camión habitual (el de Ajustes), otro, o
 * «sin camión». Si el camión elegido lo lleva otro chofer ese día, no se pisa: se dice quién lo tiene y se ofrece
 * INTERCAMBIAR. El servidor es quien decide (y quien comprueba el permiso); esto solo pregunta.
 *
 * Sin permiso —el chofer en su ruta, «Ruta de hoy»— es la misma pastilla sin botón, y solo si hay camión.
 */
export function CamionDelChofer({ chofer, driverId, asignado, asignaciones, camiones, puedeCambiar, asigna, t }: {
  chofer: string;
  driverId: string;
  /** Lo de este chofer ese día; `undefined` si no tiene camión ni habitual. */
  asignado: CamionAsignado | undefined;
  /** Todas las del día, para decir en la lista quién lleva cada camión. */
  asignaciones: readonly CamionAsignado[];
  camiones: readonly CamionElegible[];
  puedeCambiar: boolean;
  asigna: (driverId: string, imei: string | null | "usual", intercambia?: boolean) => Promise<ResultadoDeAsignar>;
  t: T;
}) {
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicto, setConflicto] = useState<ConflictoDeCamion | null>(null);
  const [haciaLaDerecha, setHaciaLaDerecha] = useState(false);
  const caja = useRef<HTMLSpanElement>(null);
  const cierra = () => { setAbierto(false); setConflicto(null); setError(null); };
  useCierraAlSalir(abierto, cierra, () => [caja.current]);

  const nombre = asignado?.truck ?? null;
  const titulo = nombre
    ? t(`${chofer}'s truck this day: ${nombre}${asignado?.origin === "usual" ? " (their usual truck)" : ""}`, `Camión de ${chofer} este día: ${nombre}${asignado?.origin === "usual" ? " (su camión habitual)" : ""}`)
    : t(`${chofer} has no truck this day`, `${chofer} no tiene camión este día`);

  if (!puedeCambiar) {
    if (!nombre) return null;
    return <span className="sema" data-camion-del-chofer={driverId} data-solo-lectura title={titulo} style={{ border: "1px solid var(--line)", color: "var(--gray)" }}>🚛 {nombre}</span>;
  }

  const quienLleva = new Map(asignaciones.flatMap((a) => (a.imei && a.driverId !== driverId ? [[a.imei, a.driver] as const] : [])));
  const pide = async (imei: string | null | "usual", intercambia = false) => {
    if (ocupado) return;
    setOcupado(true); setError(null);
    const r = await asigna(driverId, imei, intercambia);
    setOcupado(false);
    if (r.ok) { cierra(); return; }
    if ("conflicto" in r) { setConflicto(r.conflicto); return; }
    setError(r.error);
  };
  // Qué está elegido ahora: «el habitual» solo cuando de verdad lo lleva por ser el habitual.
  const valor = !asignado || !asignado.imei ? (asignado?.origin === "day" ? "none" : "usual") : asignado.origin === "usual" ? "usual" : asignado.imei;

  return (
    // La tarjeta entera, pulsada, suelta la parada enfocada: lo de aquí dentro no es «pulsar fuera».
    <span ref={caja} style={{ position: "relative", display: "inline-block" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn btn-ghost btn-sm" data-camion-del-chofer={driverId} aria-haspopup="dialog" aria-expanded={abierto}
        title={`${titulo} — ${t("click to change it", "pulse para cambiarlo")}`}
        onClick={(e) => { setHaciaLaDerecha(e.currentTarget.getBoundingClientRect().left < 260); if (abierto) cierra(); else setAbierto(true); }}>
        🚛 {nombre ?? t("no truck", "sin camión")}
      </button>
      {abierto && (
        <div className="col-menu" data-popover-camion-del-chofer role="dialog" aria-label={t("Truck for this day", "Camión de este día")}
          style={{ width: 270, padding: 10, ...(haciaLaDerecha ? { left: 0, right: "auto" } : {}) }}>
          {!conflicto ? (
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--gray)", fontWeight: 600 }}>
              🚛 {t(`Truck for ${chofer} this day`, `Camión de ${chofer} este día`)}
              <select data-selector-de-camion value={valor} disabled={ocupado} style={{ width: "100%" }}
                onChange={(e) => { const v = e.target.value; void pide(v === "none" ? null : v === "usual" ? "usual" : v); }}>
                <option value="usual">{asignado?.usualTruck ? t(`Usual truck (${asignado.usualTruck})`, `Camión habitual (${asignado.usualTruck})`) : t("Usual truck (none set in Settings)", "Camión habitual (ninguno en Ajustes)")}</option>
                <option value="none">{t("No truck this day", "Sin camión este día")}</option>
                {camiones.map((c) => (
                  <option key={c.imei} value={c.imei}>{c.name}{quienLleva.has(c.imei) ? ` — ${t("with", "con")} ${quienLleva.get(c.imei)}` : ""}</option>
                ))}
              </select>
            </label>
          ) : (
            <div data-conflicto-de-camion style={{ fontSize: 13 }}>
              <p style={{ margin: "0 0 8px" }}>
                {t(`${conflicto.truck} is with ${conflicto.driver} this day.`, `${conflicto.truck} lo lleva ${conflicto.driver} este día.`)}{" "}
                {conflicto.inReturn
                  ? t(`Swap them? ${conflicto.driver} gets ${conflicto.inReturn}.`, `¿Intercambiarlos? ${conflicto.driver} se queda con ${conflicto.inReturn}.`)
                  : t(`Give it to ${chofer}? ${conflicto.driver} is left without a truck.`, `¿Dárselo a ${chofer}? ${conflicto.driver} se queda sin camión.`)}
              </p>
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost btn-sm" data-cancelar-intercambio disabled={ocupado} onClick={() => setConflicto(null)}>{t("Cancel", "Cancelar")}</button>
                <button type="button" className="btn btn-primary btn-sm" data-intercambiar-camion disabled={ocupado} onClick={() => void pide(conflicto.imei, true)}>
                  {conflicto.inReturn ? t("Swap", "Intercambiar") : t("Give it", "Dárselo")}
                </button>
              </div>
            </div>
          )}
          {error && <p className="hint" data-error-de-camion style={{ color: "var(--red)", margin: "6px 0 0" }}>{error}</p>}
        </div>
      )}
    </span>
  );
}
