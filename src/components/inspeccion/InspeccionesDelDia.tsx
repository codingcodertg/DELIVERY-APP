"use client";

import { useMemo, useState } from "react";
import "./inspeccion.css";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { PhotoUpload } from "@/components/PhotoUpload";
import { BadgeDeSeguridad } from "@/components/inspeccion/BadgeDeSeguridad";
import { puntoPorId, textoDelPunto } from "@/lib/inspeccion/puntos";
import {
  choferesConRuta, defectos, defectosAbiertos, estadoDeLaInspeccion, horaDelNegocio, ordenParaLogistica, resumenDelDia,
  revisaLasDelEquipo,
  type Inspeccion,
} from "@/lib/inspeccion/reglas";
import { useInspecciones } from "@/lib/inspeccion/usa-inspecciones";
import { shiftDateISO, todayISO } from "@/lib/utils";

/**
 * Las inspecciones pre-viaje del día, para logística y el admin (D-NEXT): quién, con qué vehículo, a qué hora, si es
 * seguro salir, y cada defecto con su foto. Lo que pide acción va arriba (`ordenParaLogistica`); un defecto abierto se
 * marca «corregido» aquí. Y quién tiene ruta ese día y aún no inspeccionó.
 */
export function InspeccionesDelDia() {
  const { me, deliveries, notify } = useData();
  const { t, lang } = usePrefs();
  const es = lang === "es";
  const [fecha, setFecha] = useState(todayISO());
  const { estado, filas, detalle, recarga, corrige, local } = useInspecciones(fecha, null);
  const [corrigiendo, setCorrigiendo] = useState<{ id: string; punto: string } | null>(null);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const ordenadas = useMemo(() => ordenParaLogistica(filas), [filas]);
  const conRuta = useMemo(() => choferesConRuta(deliveries, fecha), [deliveries, fecha]);
  const resumen = resumenDelDia(filas, conRuta);
  const puedeCorregir = revisaLasDelEquipo(me?.role);
  const hoy = todayISO();

  const marca = async (f: Inspeccion, punto: string, corregido: boolean) => {
    if (guardando) return;
    setGuardando(true);
    const r = await corrige(f.id, punto, corregido, corregido ? nota : "");
    setGuardando(false);
    if (r.ok) { setCorrigiendo(null); setNota(""); notify(corregido ? t("Marked as fixed", "Marcado como corregido") : t("Reopened", "Reabierto")); }
    else notify(t("Could not save: ", "No se pudo guardar: ") + r.detalle);
  };

  return (
    <>
      <div className="page-head">
        <h2>✅ {t("Pre-trip inspections", "Inspecciones pre-viaje")}</h2>
        <span className="hint">{local ? t("Saved on this browser only", "Solo en este navegador") : ""}</span>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div className="viewtoggle" data-dia-de-inspecciones>
          {([[-1, t("Yesterday", "Ayer")], [0, t("Today", "Hoy")]] as const).map(([d, rotulo]) => (
            <button key={d} className={`vt${fecha === shiftDateISO(hoy, d) ? " on" : ""}`} onClick={() => setFecha(shiftDateISO(hoy, d))}>{rotulo}</button>
          ))}
        </div>
        <input type="date" value={fecha} max={hoy} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label={t("Day", "Día")} style={{ width: "auto" }} />
        <button className="btn btn-sm btn-ghost" onClick={recarga}>↻ {t("Refresh", "Actualizar")}</button>
      </div>

      {estado === "sin_tabla" && (
        <div className="banner warn" role="status" data-aun-no-se-guarda>
          <b>{t("Inspections can't be saved yet.", "Las inspecciones aún no se pueden guardar.")}</b>{" "}
          {t("The database needs migration 165 (vehicle_inspections). Until then drivers can see the checklist but not send it.",
             "Falta aplicar la migración 165 (vehicle_inspections). Hasta entonces los choferes ven la lista pero no pueden enviarla.")}
        </div>
      )}
      {estado === "error" && <div className="banner err" role="alert">{t("Could not read the inspections: ", "No se pudieron leer las inspecciones: ")}{detalle}</div>}
      {estado === "cargando" && <div className="empty">{t("Loading…", "Cargando…")}</div>}

      {estado === "listo" && (
        <>
          <div className="insp-resumen" data-resumen>
            <span className="badge insp-badge-seguro">{t(`${resumen.hechas} done`, `${resumen.hechas} hechas`)}</span>
            {resumen.noSeguras > 0 && <span className="badge insp-badge-no-seguro">⛔ {t(`${resumen.noSeguras} not safe`, `${resumen.noSeguras} no seguras`)}</span>}
            {resumen.defectosAbiertos > 0 && <span className="badge insp-badge-no-seguro">⚠ {t(`${resumen.defectosAbiertos} open defect(s)`, `${resumen.defectosAbiertos} defecto(s) abiertos`)}</span>}
          </div>
          {resumen.sinInspeccion.length > 0 && (
            <div className="banner warn" data-sin-inspeccion>
              {t("With a route that day and no inspection: ", "Con ruta ese día y sin inspección: ")}<b>{resumen.sinInspeccion.join(", ")}</b>
            </div>
          )}
          {ordenadas.length === 0 && <div className="empty">{t("No inspections that day.", "Ninguna inspección ese día.")}</div>}

          {ordenadas.map((f) => {
            const abiertos = defectosAbiertos(f);
            const todos = defectos(f.answers);
            const est = estadoDeLaInspeccion(f);
            return (
              <div key={f.id} className={`card insp-tarjeta${est === "no_segura" ? " no-segura" : abiertos.length ? " abierta" : ""}`} data-inspeccion={f.id} data-estado={est}>
                <div className="insp-tarjeta-cab">
                  <b>{f.driver_name}</b>
                  <span>🚚 {f.vehicle_label}</span>
                  {f.odometer != null && <span className="hint" style={{ marginTop: 0 }}>{f.odometer.toLocaleString("en-US")} mi</span>}
                  <span className="hint" style={{ marginTop: 0 }}>🕒 {horaDelNegocio(f.created_at, es)}</span>
                  <BadgeDeSeguridad est={est} t={t} />
                </div>
                {f.notes && <div className="hint">📝 {f.notes}</div>}
                {todos.length === 0 ? (
                  <div className="hint">{t("No defects.", "Sin defectos.")}</div>
                ) : (
                  <ul className="insp-defectos">
                    {todos.map((id) => {
                      const rep = f.repairs[id];
                      const abierto = !rep;
                      const r = f.answers[id];
                      const editando = corrigiendo?.id === f.id && corrigiendo.punto === id;
                      return (
                        <li key={id} className={`insp-defecto-fila${abierto ? " abierto" : ""}`} data-defecto={id} data-abierto={abierto ? "si" : "no"}>
                          <b>{abierto ? "⚠ " : "✓ "}{textoDelPunto(id, es)}</b>
                          {puntoPorId(id)?.critico && <span className="insp-critico">{t("critical", "crítico")}</span>}
                          {r?.nota && <div>{r.nota}</div>}
                          {(r?.fotos ?? []).length > 0 && <PhotoUpload photos={r!.fotos!} onChange={() => {}} disabled t={t} />}
                          {rep && (
                            <div className="insp-corregido">
                              ✓ {t("Fixed", "Corregido")} · {rep.by_name ?? ""} · {horaDelNegocio(rep.at, es)}{rep.note ? ` — ${rep.note}` : ""}
                              {puedeCorregir && <> <button className="btn btn-sm btn-ghost" disabled={guardando} onClick={() => void marca(f, id, false)}>{t("Reopen", "Reabrir")}</button></>}
                            </div>
                          )}
                          {abierto && puedeCorregir && !editando && (
                            <div style={{ marginTop: 8 }}>
                              <button className="btn btn-sm btn-green" data-marcar-corregido onClick={() => { setCorrigiendo({ id: f.id, punto: id }); setNota(""); }}>
                                ✓ {t("Mark as fixed", "Marcar corregido")}
                              </button>
                            </div>
                          )}
                          {editando && (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                              <input type="text" placeholder={t("What was done (optional)", "Qué se hizo (opcional)")} value={nota} onChange={(e) => setNota(e.target.value)} style={{ flex: "1 1 220px" }} />
                              <button className="btn btn-sm btn-green" data-guardar-corregido disabled={guardando} onClick={() => void marca(f, id, true)}>{t("Save", "Guardar")}</button>
                              <button className="btn btn-sm btn-ghost" onClick={() => setCorrigiendo(null)}>{t("Cancel", "Cancelar")}</button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

