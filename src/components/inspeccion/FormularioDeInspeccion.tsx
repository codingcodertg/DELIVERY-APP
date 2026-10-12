"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./inspeccion.css";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { PhotoUpload } from "@/components/PhotoUpload";
import { SECCIONES, puntoPorId, textoDelPunto, type Punto, type Seccion } from "@/lib/inspeccion/puntos";
import {
  MAX_FOTOS_POR_DEFECTO, borradorVacio, defectos, defectosCriticos, delChoferEnElDia, esSeguroParaSalir, estadoDeLaInspeccion, etiquetaDeVehiculo,
  faltasParaEnviar, horaDelNegocio, inspeccionParaGuardar, opcionesDe, primeraSeccionConFaltas, progreso, progresoDeSeccion,
  trasContestar, yaHechaConEsteVehiculo,
  type Borrador, type Estado, type Falta, type Inspeccion, type Respuesta,
} from "@/lib/inspeccion/reglas";
import { vehiculoPorDefecto } from "@/lib/inspeccion/almacen";
import { BadgeDeSeguridad } from "@/components/inspeccion/BadgeDeSeguridad";
import { useInspecciones, useVehiculos } from "@/lib/inspeccion/usa-inspecciones";
import { fmtDate, todayISO } from "@/lib/utils";

/**
 * La inspección pre-viaje del chofer (D-518): vehículo y cuentakilómetros, la lista por zonas del camión con
 * OK / Defecto / No aplica, la foto y la nota de cada defecto, y la firma. Una por chofer, por día y por vehículo:
 * hecha, se ve hecha con su hora. Qué cuenta, qué falta y si es seguro salir lo decide `lib/inspeccion/reglas.ts`.
 */

const llaveDelBorrador = (chofer: string, fecha: string) => `rtg_inspeccion_borrador:${chofer}:${fecha}`;
const OTRO = "__otro__";

function leeBorrador(llave: string): Borrador | null {
  try {
    const crudo = window.localStorage.getItem(llave);
    return crudo ? { ...borradorVacio(), ...(JSON.parse(crudo) as Partial<Borrador>) } : null;
  } catch {
    return null;
  }
}

export function FormularioDeInspeccion() {
  const { me, notify } = useData();
  const { t, lang } = usePrefs();
  const es = lang === "es";
  const hoy = todayISO();
  const { estado, filas, detalle, recarga, guarda, local } = useInspecciones(hoy, me?.id ?? null);
  const vehiculos = useVehiculos();
  const llave = me ? llaveDelBorrador(me.id, hoy) : "";

  const [borrador, setBorrador] = useState<Borrador>(borradorVacio);
  const [cargado, setCargado] = useState(false);
  const [abiertas, setAbiertas] = useState<Set<Seccion["id"]>>(() => new Set([SECCIONES[0].id]));
  const [intento, setIntento] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [otroVehiculo, setOtroVehiculo] = useState(false);
  const refs = useRef<Partial<Record<Seccion["id"], HTMLElement | null>>>({});

  // El borrador vive en el teléfono hasta enviarlo: una recarga o una llamada no borran lo marcado.
  useEffect(() => {
    if (!llave) return;
    const b = leeBorrador(llave);
    if (b) setBorrador(b);
    setCargado(true);
  }, [llave]);
  useEffect(() => {
    if (!cargado || !llave) return;
    try { window.localStorage.setItem(llave, JSON.stringify(borrador)); } catch { /* sin sitio (fotos): el borrador dura la visita */ }
  }, [borrador, cargado, llave]);

  // El vehículo sale elegido: el asignado, o el primero (D-489). Solo si el chofer aún no eligió.
  useEffect(() => {
    if (!cargado || borrador.vehiculo || !vehiculos) return;
    const v = vehiculoPorDefecto(vehiculos.vehiculos);
    if (v) setBorrador((b) => (b.vehiculo ? b : { ...b, vehiculo: v }));
  }, [cargado, vehiculos, borrador.vehiculo]);

  const faltas = useMemo(() => faltasParaEnviar(borrador), [borrador]);
  const avance = progreso(borrador.respuestas);
  const criticos = defectosCriticos(borrador.respuestas);
  const hechas = me ? delChoferEnElDia(filas, me.id, hoy) : [];
  const repetida = me ? yaHechaConEsteVehiculo(filas, me.id, hoy, borrador.vehiculo) : false;
  const idsConFalta = new Set(intento ? faltas.flatMap((f) => ("ids" in f ? f.ids : [])) : []);

  if (!me) return null;
  // Sin esperar al borrador guardado: llega en el primer efecto, un instante después. `cargado` solo impide que el
  // borrador vacío del primer pintado pise el guardado.
  if (estado === "cargando") return <div className="empty">{t("Loading…", "Cargando…")}</div>;

  const responde = (seccion: Seccion["id"], p: Punto, estadoNuevo: Estado) => {
    const antes = borrador.respuestas[p.id];
    const r: Respuesta = estadoNuevo === "defecto" ? { estado: "defecto", nota: antes?.nota ?? "", fotos: antes?.fotos ?? [] } : { estado: estadoNuevo };
    const respuestas = { ...borrador.respuestas, [p.id]: r };
    setBorrador({ ...borrador, respuestas });
    const paso = trasContestar(seccion, respuestas);
    if (paso.cerrar) {
      setAbiertas((a) => { const n = new Set(a); n.delete(seccion); if (paso.abrir) n.add(paso.abrir); return n; });
      if (paso.abrir) { const id = paso.abrir; setTimeout(() => refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
    }
  };
  const cambiaDefecto = (id: string, cambio: Partial<Respuesta>) =>
    setBorrador((b) => ({ ...b, respuestas: { ...b.respuestas, [id]: { ...(b.respuestas[id] ?? { estado: "defecto" }), ...cambio } } }));
  const alterna = (id: Seccion["id"]) => setAbiertas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const enviar = async () => {
    setIntento(true);
    if (faltas.length) {
      const s = primeraSeccionConFaltas(faltas);
      if (s) { setAbiertas((a) => new Set(a).add(s)); setTimeout(() => refs.current[s]?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }
      return;
    }
    if (guardando) return;
    setGuardando(true);
    const r = await guarda(inspeccionParaGuardar(borrador, { id: me.id, nombre: me.full_name }, hoy));
    setGuardando(false);
    if (r.ok) {
      try { window.localStorage.removeItem(llave); } catch { /* nada */ }
      setBorrador(borradorVacio());
      setIntento(false);
      setOtroVehiculo(false);
      notify(r.fila.safe ? t("Inspection saved", "Inspección guardada") : t("Inspection saved — NOT safe to drive", "Inspección guardada — NO es seguro salir"));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (r.motivo === "repetida") {
      notify(t("You already inspected this vehicle today.", "Ya inspeccionaste este vehículo hoy."));
    } else if (r.motivo !== "sin_tabla") {
      notify(t("Could not save: ", "No se pudo guardar: ") + (r.detalle ?? ""));
    }
  };

  const textoDeFalta = (f: Falta): string => {
    switch (f.tipo) {
      case "vehiculo": return t("Choose the vehicle.", "Elige el vehículo.");
      case "odometro": return t("Write the odometer (numbers only).", "Escribe el odómetro (solo números).");
      case "sin_contestar": return t(`${f.ids.length} item(s) still unanswered.`, `Faltan ${f.ids.length} punto(s) por contestar.`);
      case "defecto_sin_nota": return t("Each defect needs a note: ", "Cada defecto lleva una nota: ") + f.ids.map((id) => textoDelPunto(id, es)).join(", ");
      case "defecto_sin_foto": return t("Each defect needs a photo: ", "Cada defecto lleva una foto: ") + f.ids.map((id) => textoDelPunto(id, es)).join(", ");
      case "certificar": return t("Check the box to certify the inspection.", "Marca la casilla para certificar la inspección.");
    }
  };

  const avisoDeBase = estado === "sin_tabla" ? (
    <div className="banner warn" role="status" data-aun-no-se-guarda>
      <b>{t("This can't be saved yet.", "Aún no se puede guardar.")}</b>{" "}
      {t("The database doesn't have the inspections table yet (migration 165). You can go through the list; what you mark stays on this phone.",
         "La base todavía no tiene la tabla de inspecciones (migración 165). Puedes recorrer la lista; lo que marques se queda en este teléfono.")}
    </div>
  ) : estado === "error" ? (
    <div className="banner err" role="alert">
      {t("Could not read your inspections: ", "No se pudieron leer tus inspecciones: ")}{detalle}{" "}
      <button className="btn btn-sm btn-ghost" onClick={recarga}>{t("Retry", "Reintentar")}</button>
    </div>
  ) : null;

  const cabecera = (
    <div className="page-head">
      <h2>✅ {t("Pre-trip inspection", "Inspección pre-viaje")}</h2>
      <span className="hint">{t("Checklist", "Lista")} · {fmtDate(hoy)}{local ? ` · ${t("saved on this browser only", "solo en este navegador")}` : ""}</span>
    </div>
  );

  // Ya hecha hoy: se ve hecha, con su hora. Otra solo si cambia de vehículo.
  if (hechas.length && !otroVehiculo) {
    return (
      <>
        {cabecera}
        {avisoDeBase}
        {hechas.map((f) => <InspeccionHecha key={f.id} f={f} es={es} t={t} />)}
        <button className="btn btn-ghost" data-otro-vehiculo onClick={() => setOtroVehiculo(true)}>
          🔁 {t("Inspect another vehicle", "Inspeccionar otro vehículo")}
        </button>
      </>
    );
  }

  const lista = vehiculos?.vehiculos ?? [];
  const valorDelSelector = !borrador.vehiculo ? "" : borrador.vehiculo.id ?? OTRO;
  const seguro = esSeguroParaSalir(borrador.respuestas);
  const veredicto = criticos.length ? "no-seguro" : seguro ? "seguro" : "pendiente";

  return (
    <>
      {cabecera}
      {avisoDeBase}
      {otroVehiculo && (
        <div className="hint" style={{ marginBottom: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setOtroVehiculo(false)}>← {t("Back to today's inspection", "Volver a la de hoy")}</button>
        </div>
      )}

      <div className="card">
        <div className="insp-campo">
          <label htmlFor="insp-vehiculo">🚚 {t("Vehicle", "Vehículo")}</label>
          {lista.length > 0 && (
            <select
              id="insp-vehiculo" data-vehiculo value={valorDelSelector}
              onChange={(e) => {
                const v = lista.find((x) => x.id === e.target.value);
                setBorrador({ ...borrador, vehiculo: v ? { id: v.id, etiqueta: etiquetaDeVehiculo(v) } : e.target.value === OTRO ? { id: null, etiqueta: "" } : null });
              }}
            >
              <option value="" disabled>{t("Choose…", "Elige…")}</option>
              {lista.map((v) => <option key={v.id} value={v.id}>{etiquetaDeVehiculo(v)}{v.assigned ? ` — ${t("assigned to you", "el tuyo")}` : ""}</option>)}
              <option value={OTRO}>{t("Other (write it)", "Otro (escríbelo)")}</option>
            </select>
          )}
          {(lista.length === 0 || valorDelSelector === OTRO) && (
            <input
              type="text" id={lista.length ? undefined : "insp-vehiculo"} data-vehiculo-texto
              placeholder={t("Truck number or plate", "Número de camión o placa")}
              value={borrador.vehiculo?.id == null ? borrador.vehiculo?.etiqueta ?? "" : ""}
              onChange={(e) => setBorrador({ ...borrador, vehiculo: { id: null, etiqueta: e.target.value } })}
            />
          )}
          {repetida && <div className="hint" style={{ color: "var(--red)" }}>{t("You already inspected this vehicle today.", "Ya inspeccionaste este vehículo hoy.")}</div>}
        </div>
        <div className="insp-campo" style={{ marginBottom: 0 }}>
          <label htmlFor="insp-odometro">🔢 {t("Odometer (miles)", "Odómetro (millas)")}</label>
          <input
            type="text" id="insp-odometro" data-odometro inputMode="decimal" autoComplete="off"
            placeholder={t("e.g. 84213", "Ej. 84213")} value={borrador.odometro}
            onChange={(e) => setBorrador({ ...borrador, odometro: e.target.value })}
          />
        </div>
      </div>

      <div className="insp-progreso" data-progreso>
        <div className="insp-progreso-fila">
          <span className="insp-progreso-num" data-progreso-texto>{t(`${avance.hechos} of ${avance.total}`, `${avance.hechos} de ${avance.total}`)}</span>
          {criticos.length > 0
            ? <span className="badge insp-badge-no-seguro">⛔ {t("Not safe to drive", "No es seguro salir")}</span>
            : <span className="hint" style={{ marginTop: 0 }}>{t("items checked", "puntos revisados")}</span>}
        </div>
        <div className="insp-barra"><div style={{ width: `${avance.total ? Math.round((avance.hechos / avance.total) * 100) : 0}%` }} /></div>
      </div>

      {SECCIONES.map((s) => {
        const ps = progresoDeSeccion(s, borrador.respuestas);
        const abierta = abiertas.has(s.id);
        const conDefecto = s.puntos.some((p) => borrador.respuestas[p.id]?.estado === "defecto");
        return (
          <section key={s.id} className={`insp-seccion${conDefecto ? " con-defecto" : ""}`} data-seccion={s.id} ref={(el) => { refs.current[s.id] = el; }}>
            <button type="button" className="insp-seccion-cab" aria-expanded={abierta} onClick={() => alterna(s.id)}>
              <span aria-hidden>{s.icono}</span>
              <span>{es ? s.es : s.en}</span>
              <span className={`insp-cuenta${conDefecto ? " defecto" : ps.hechos === ps.total ? " completa" : ""}`} data-cuenta-seccion>
                {conDefecto ? "⚠ " : ps.hechos === ps.total ? "✓ " : ""}{ps.hechos}/{ps.total}
              </span>
              <span className="insp-flecha" aria-hidden>{abierta ? "▲" : "▼"}</span>
            </button>
            {abierta && s.puntos.map((p) => {
              const r = borrador.respuestas[p.id];
              const opciones = opcionesDe(p);
              return (
                <div key={p.id} className={`insp-punto${idsConFalta.has(p.id) ? " falta" : ""}`} data-punto={p.id}>
                  <div className="insp-punto-texto">
                    {es ? p.es : p.en}
                    {p.critico && <span className="insp-critico" title={t("A defect here means the truck is not safe to drive", "Un defecto aquí: no es seguro salir")}>{t("critical", "crítico")}</span>}
                  </div>
                  <div className="insp-opciones" style={{ ["--insp-n" as string]: opciones.length }}>
                    {opciones.map((o) => (
                      <button
                        key={o} type="button" className={`insp-op ${o}${r?.estado === o ? " on" : ""}`} aria-pressed={r?.estado === o}
                        data-opcion={o} onClick={() => responde(s.id, p, o)}
                      >
                        {o === "ok" ? "✓ OK" : o === "defecto" ? `✗ ${t("Defect", "Defecto")}` : t("N/A", "No aplica")}
                      </button>
                    ))}
                  </div>
                  {r?.estado === "defecto" && (
                    <div className="insp-defecto" data-defecto={p.id}>
                      <textarea
                        placeholder={t("What's wrong? (required)", "¿Qué tiene? (obligatorio)")} value={r.nota ?? ""}
                        onChange={(e) => cambiaDefecto(p.id, { nota: e.target.value })}
                      />
                      <PhotoUpload photos={r.fotos ?? []} onChange={(fotos) => cambiaDefecto(p.id, { fotos })} max={MAX_FOTOS_POR_DEFECTO} t={t} />
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="insp-campo">
          <label htmlFor="insp-notas">{t("Notes for the office (optional)", "Notas para la oficina (opcional)")}</label>
          <textarea id="insp-notas" value={borrador.notas} onChange={(e) => setBorrador({ ...borrador, notas: e.target.value })} />
        </div>

        <div className={`insp-veredicto ${veredicto}`} data-veredicto={veredicto}>
          {criticos.length > 0
            ? <>⛔ {t("NOT safe to drive: ", "NO es seguro salir: ")}{criticos.map((id) => textoDelPunto(id, es)).join(", ")}. {t("Tell the office before leaving.", "Avisa a la oficina antes de salir.")}</>
            : seguro
              ? <>✅ {t("Safe to drive", "Seguro para salir")}{defectos(borrador.respuestas).length ? ` — ${t("report the other defects", "reporta los otros defectos")}` : ""}</>
              : <>{t("Answer every item to know if it's safe to drive.", "Contesta todo para saber si es seguro salir.")}</>}
        </div>

        <label className="insp-certifico">
          <input type="checkbox" data-certifico checked={borrador.certificado} onChange={(e) => setBorrador({ ...borrador, certificado: e.target.checked })} />
          <span>
            {t(`I certify that I inspected this vehicle and this report is correct. — ${me.full_name}`,
               `Certifico que inspeccioné este vehículo y que este reporte es correcto. — ${me.full_name}`)}
          </span>
        </label>

        {intento && faltas.length > 0 && (
          <ul className="insp-faltas" data-faltas role="alert">
            {faltas.map((f) => <li key={f.tipo}>{textoDeFalta(f)}</li>)}
          </ul>
        )}
        {estado === "sin_tabla" && <div className="hint" style={{ marginBottom: 8 }}>{t("Sending is off until the database is ready.", "Enviar está apagado hasta que la base esté lista.")}</div>}
        <button className="btn btn-primary insp-enviar" data-enviar disabled={estado === "sin_tabla" || guardando} onClick={() => void enviar()}>
          {guardando ? t("Saving…", "Guardando…") : t("Submit inspection", "Enviar inspección")}
        </button>
      </div>
    </>
  );
}

/** Una inspección ya enviada, como la ve el chofer: hora, vehículo, si es seguro salir y sus defectos. */
function InspeccionHecha({ f, es, t }: { f: Inspeccion; es: boolean; t: (en: string, es: string) => string }) {
  const def = defectos(f.answers);
  const est = estadoDeLaInspeccion(f);
  return (
    <div className={`card insp-tarjeta${est === "no_segura" ? " no-segura" : ""}`} data-inspeccion-hecha={f.id} data-estado={est}>
      <div className="insp-tarjeta-cab">
        <b>✓ {t("Done at", "Hecha a las")} {horaDelNegocio(f.created_at, es)}</b>
        <span>{f.vehicle_label}{f.odometer != null ? ` · ${f.odometer.toLocaleString("en-US")} mi` : ""}</span>
        <BadgeDeSeguridad est={est} t={t} />
      </div>
      {est === "no_segura" && <div className="banner err" style={{ marginTop: 10, marginBottom: 0 }}>{t("Don't drive this truck until the office says so.", "No salgas con este camión hasta que la oficina te diga.")}</div>}
      {est === "corregida" && <div className="banner ok" style={{ marginTop: 10, marginBottom: 0 }}>{t("Logistics marked the critical defects as fixed.", "Logística marcó corregidos los defectos críticos.")}</div>}
      {def.length > 0 ? (
        <ul className="insp-defectos">
          {def.map((id) => (
            <li key={id} className={`insp-defecto-fila${f.repairs[id] ? "" : " abierto"}`}>
              <b>{textoDelPunto(id, es)}</b>{puntoPorId(id)?.critico ? <span className="insp-critico">{t("critical", "crítico")}</span> : null}
              {f.answers[id]?.nota && <div>{f.answers[id]?.nota}</div>}
              {f.repairs[id] && <div className="insp-corregido">✓ {t("Fixed", "Corregido")} · {f.repairs[id].by_name ?? ""} · {horaDelNegocio(f.repairs[id].at, es)}</div>}
            </li>
          ))}
        </ul>
      ) : <div className="hint">{t("No defects.", "Sin defectos.")}</div>}
    </div>
  );
}
