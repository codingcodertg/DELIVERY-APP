"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { driverNames, stageLabel } from "@/lib/constants";
import { hermanasDe } from "@/lib/cargas-partidas";
import { formateadorDeFecha } from "@/lib/formateador";
import { maxFechaDeEntrega } from "@/lib/dia-de-entrega";
import {
  avisosDeRelevo, esPasoDeRelevo, estadoDelRelevo, etiquetaDeRelevo, letraDelPaso, PASTILLA_DE_RELEVO, pasosDelRelevo, pasosParaVer,
  porQueNoSeActiva, primerDiaDelPasoB, problemaDelDiaDelPasoB, puedeGestionarRelevo, sePuedeDeshacer, TEXTO_DEL_DIA, textoDelEstado,
  tiendasDeRelevo, type PasoParaVer,
} from "@/lib/relevo";
import { BUSINESS_TZ, fmtDate, orderLabel, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * TRANSFERENCIA POR RELEVO (D-NEXT, migración 256; la regla, en `lib/relevo`).
 *
 * Dos piezas, las dos aquí para que el Gestor de Rutas solo tenga que nombrarlas:
 *
 *   · `PastillaDeRelevo`: la etiqueta «⇄ Transferencia» que lleva cada paso (Tr-1111-a, Tr-1111-b) allí donde sale su
 *     número, para que se reconozca de un vistazo y no se confunda con una carga partida (1111a / 1111b).
 *   · `RelevoDeLaOrden`: en una orden de tienda a tienda sin relevo, el botón «⇄» que lo ACTIVA (tienda de relevo + día de
 *     recogida del paso b), solo para quien planifica rutas; en un paso de relevo, la pastilla es el botón y abre la
 *     TARJETA del relevo: el estado de la orden entera, cada paso con quién y cuándo, el día y el chofer del paso b (que
 *     quien planifica puede cambiar) y «Deshacer el relevo» mientras el paso a no se haya recogido.
 *
 * Todo se abre EN SU SITIO, como una tarjeta encima de la pantalla: nada navega a otra app.
 */

const ESTILO_PASTILLA: React.CSSProperties = { background: "#6d28d9", color: "#fff", whiteSpace: "nowrap" };

/** La pastilla. `null` si la orden no es un paso de relevo. */
export function PastillaDeRelevo({ d, lang, style }: { d: Pick<Delivery, "relay_step" | "order_suffix"> & { pickup_name?: string | null; delivery_name?: string | null }; lang: "en" | "es"; style?: React.CSSProperties }) {
  if (!esPasoDeRelevo(d)) return null;
  const letra = d.order_suffix ?? letraDelPaso(d.relay_step as number);
  const tramo = d.pickup_name || d.delivery_name ? `: ${d.pickup_name ?? "?"} → ${d.delivery_name ?? "?"}` : "";
  return (
    <span className="sema pastilla-relevo" data-relevo={d.relay_step} style={{ ...ESTILO_PASTILLA, ...style }}
      title={lang === "es" ? `Transferencia por relevo, paso ${letra}${tramo}` : `Relay transfer, step ${letra}${tramo}`}>
      ⇄ {PASTILLA_DE_RELEVO[lang]} {letra}
    </span>
  );
}

const cuando = (iso: string | null | undefined, lang: "en" | "es"): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formateadorDeFecha(lang === "es" ? "es-MX" : "en-US", { timeZone: BUSINESS_TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
};

export function RelevoDeLaOrden({ pedido, compacto = false, soloLectura = false }: {
  pedido: Delivery;
  /** En una fila de tabla: solo el icono (para activar) o la pastilla (si ya es un relevo). */
  compacto?: boolean;
  /** Quien solo mira (la vista de solo lectura del Gestor): ve la tarjeta, no activa ni cambia nada. */
  soloLectura?: boolean;
}) {
  const { me, deliveries, settings, users, events, activarRelevo, deshacerRelevo, pasosDelRelevo: leePasos, updateDelivery, notify } = useData();
  const { lang, t } = usePrefs();
  const confirmar = useConfirm();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const hoy = todayISO();
  const esRelevo = esPasoDeRelevo(pedido);
  const puede = !soloLectura && !!me && puedeGestionarRelevo(me);

  // ---- Activar ----
  const candidatas = useMemo(() => tiendasDeRelevo(pedido, settings.stores ?? []), [pedido, settings.stores]);
  const seActiva = !esRelevo && puede && porQueNoSeActiva(pedido, hermanasDe(deliveries, pedido), settings.stores ?? [], settings.order_type_rules) === null && candidatas.length > 0;
  const primerDia = primerDiaDelPasoB(pedido.delivery_date, hoy);
  const [tienda, setTienda] = useState("");
  const [fecha, setFecha] = useState(primerDia);
  const problemaDia = problemaDelDiaDelPasoB(fecha, pedido.delivery_date, hoy);

  // ---- La tarjeta de un relevo que ya existe ----
  const familia = useMemo(() => (esRelevo ? pasosDelRelevo(deliveries, pedido) : []), [esRelevo, deliveries, pedido]);
  const [pasos, setPasos] = useState<PasoParaVer[]>([]);
  useEffect(() => {
    if (!abierto || !esRelevo) return;
    let vivo = true;
    // Primero lo que ya está a la vista; después lo que dice la base (que también ve el paso de otro chofer).
    setPasos(pasosParaVer(familia, events, (id) => users.find((u) => u.id === id)?.full_name ?? null));
    void leePasos(pedido.id).then((p) => { if (vivo && p.length) setPasos(p); });
    return () => { vivo = false; };
  }, [abierto, esRelevo, pedido.id, familia, events, users, leePasos]);

  if (!esRelevo && !seActiva) return null;

  const abrir = () => { setTienda(candidatas[0]?.name ?? ""); setFecha(primerDia); setAbierto(true); };
  const cerrar = () => { if (!guardando) setAbierto(false); };
  const numero = pedido.order_code || String(pedido.order_no);
  const destinoFinal = esRelevo ? (pasos[pasos.length - 1]?.delivery_name ?? familia[familia.length - 1]?.delivery_name ?? "?") : (pedido.delivery_name ?? "?");

  const activar = async () => {
    if (!tienda || problemaDia || guardando) return;
    setGuardando(true);
    const id = await activarRelevo(pedido.id, tienda, fecha);
    setGuardando(false);
    if (!id) return;
    notify(t(`Relay transfer set up: ${etiquetaDeRelevo(numero, "a")} (${pedido.pickup_name} → ${tienda}) and ${etiquetaDeRelevo(numero, "b")} (${tienda} → ${pedido.delivery_name}, pickup ${fecha}). Assign a driver to each step.`,
      `Relevo activado: ${etiquetaDeRelevo(numero, "a")} (${pedido.pickup_name} → ${tienda}) y ${etiquetaDeRelevo(numero, "b")} (${tienda} → ${pedido.delivery_name}, recogida el ${fecha}). Asigna un chofer a cada paso.`));
    setAbierto(false);
  };
  const deshacer = async () => {
    if (guardando) return;
    const ok = await confirmar(
      t(`Undo the relay transfer? #${numero} becomes one order again, straight to ${destinoFinal}. The other step is removed, with its driver and its day.`,
        `¿Deshacer la transferencia por relevo? #${numero} vuelve a ser una sola orden, directa a ${destinoFinal}. El otro paso se quita, con su chofer y su día.`),
      { confirmLabel: t("Undo the relay", "Deshacer el relevo") },
    );
    if (!ok) return;
    setGuardando(true);
    const hecho = await deshacerRelevo(pedido.id);
    setGuardando(false);
    if (hecho) { notify(t(`Relay undone: #${numero} is one order again.`, `Relevo deshecho: #${numero} vuelve a ser una sola orden.`)); setAbierto(false); }
  };

  const estado = estadoDelRelevo(pasos.length ? pasos : familia);
  const avisos = esRelevo ? avisosDeRelevo(familia) : [];
  const choferes = driverNames(users);

  return (
    <span className={compacto ? "accion-de-fila" : undefined} data-relevo-de-la-orden onClick={(e) => e.stopPropagation()}>
      {esRelevo ? (
        <button type="button" data-abre-relevo={pedido.id} onClick={() => setAbierto(true)}
          style={{ all: "unset", cursor: "pointer", marginLeft: compacto ? 4 : 0 }}
          aria-label={t("Relay transfer: see the steps", "Transferencia por relevo: ver los pasos")}>
          <PastillaDeRelevo d={pedido} lang={lang} />
        </button>
      ) : compacto ? (
        <button type="button" className="btn-icono-fila" data-activar-relevo={pedido.id} onClick={abrir}
          aria-label={t("Relay transfer", "Transferencia por relevo")}
          title={t("Relay transfer: one driver takes it to a relay store, another takes it from there", "Transferencia por relevo: un chofer la lleva a una tienda de relevo y otro la lleva desde ahí")}>
          ⇄
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" data-activar-relevo={pedido.id} onClick={abrir}
          title={t("One driver takes it to a relay store, another takes it from there", "Un chofer la lleva a una tienda de relevo y otro la lleva desde ahí")}>
          ⇄ {t("Relay transfer", "Transferencia por relevo")}
        </button>
      )}

      {abierto && !esRelevo && (
        <div className="overlay" data-dialogo-relevo="activar" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 460 }}>
            <h3 style={{ marginTop: 0 }}>⇄ {t("Relay transfer", "Transferencia por relevo")} · #{orderLabel(pedido)}</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {t(`${pedido.pickup_name} → ${pedido.delivery_name}. One driver takes it to a relay store; another one, the same day or later, takes it from there.`,
                `${pedido.pickup_name} → ${pedido.delivery_name}. Un chofer la lleva a una tienda de relevo; otro, el mismo día o después, la lleva desde ahí.`)}
            </p>
            <div className="field">
              <label>{t("Relay store", "Tienda de relevo")}</label>
              <select data-tienda-de-relevo value={tienda} onChange={(e) => setTienda(e.target.value)}>
                {candidatas.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t("Pickup day of step b", "Día de recogida del paso b")}</label>
              <input type="date" data-dia-del-paso-b value={fecha} min={primerDia} max={maxFechaDeEntrega(hoy)} onChange={(e) => setFecha(e.target.value)} />
              {problemaDia && <div className="hint" data-problema-del-dia style={{ color: "var(--red)" }}>{TEXTO_DEL_DIA[problemaDia][lang]}</div>}
            </div>
            <div className="hint" data-resumen-del-relevo style={{ display: "grid", gap: 4 }}>
              <span><b>{etiquetaDeRelevo(numero, "a")}</b> · {pedido.pickup_name} → {tienda || "…"} · {pedido.delivery_date ? fmtDate(pedido.delivery_date) : t("no day yet", "sin día")}</span>
              <span><b>{etiquetaDeRelevo(numero, "b")}</b> · {tienda || "…"} → {pedido.delivery_name} · {fecha ? fmtDate(fecha) : "…"}</span>
              <span>{t("Step b can only be picked up once step a is delivered at the relay store.", "El paso b solo se puede recoger cuando el paso a esté entregado en la tienda de relevo.")}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={guardando} onClick={cerrar}>{t("Cancel", "Cancelar")}</button>
              <button type="button" className="btn btn-primary" data-confirmar-relevo style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
                disabled={!tienda || !!problemaDia || guardando} onClick={() => void activar()}>
                {guardando ? t("Saving…", "Guardando…") : t("Set up the relay", "Activar el relevo")}
              </button>
            </div>
          </div>
        </div>
      )}

      {abierto && esRelevo && (
        <div className="overlay" data-dialogo-relevo="tarjeta" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 520 }}>
            <h3 style={{ marginTop: 0 }}>⇄ {t("Relay transfer", "Transferencia por relevo")} · #{numero}</h3>
            <p data-estado-del-relevo={estado.etapa} style={{ margin: "0 0 10px", fontWeight: 700 }}>{textoDelEstado(estado, lang === "es")}</p>
            <div style={{ display: "grid", gap: 10 }}>
              {pasos.map((p, k) => {
                const anterior = k > 0 ? pasos[k - 1] : null;
                const espera = !!anterior && anterior.stage !== "delivered" && p.stage !== "picked_up" && p.stage !== "delivered";
                const fila = familia.find((f) => f.id === p.id);
                const editable = puede && !!fila && k > 0 && p.stage !== "picked_up" && p.stage !== "delivered" && p.stage !== "canceled";
                return (
                  <div key={p.id} data-paso-de-relevo={p.relay_step} data-etapa={p.stage} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b>{etiquetaDeRelevo(numero, p.order_suffix ?? letraDelPaso(p.relay_step))}</b>
                      <span className="badge" style={{ background: "var(--line)" }}>{stageLabel(p.stage, lang)}</span>
                      {espera && <span className="badge" data-espera-al-anterior style={{ background: "var(--amber-soft)", color: "var(--amber-text)" }}>
                        {t(`Waits for step ${anterior?.order_suffix ?? "a"}`, `Espera al paso ${anterior?.order_suffix ?? "a"}`)}</span>}
                    </div>
                    <div style={{ marginTop: 4 }}>{p.pickup_name ?? "?"} → {p.delivery_name ?? "?"}</div>
                    <div className="hint" style={{ margin: "4px 0 0" }}>
                      {t("Driver", "Chofer")}: {p.assigned_driver || t("not assigned", "sin asignar")} · {t("Day", "Día")}: {p.delivery_date ? fmtDate(p.delivery_date) : "—"}
                    </div>
                    {p.picked_up_at && <div className="hint" data-recogido style={{ margin: "2px 0 0" }}>{t("Picked up", "Recogido")}{p.picked_up_by ? ` · ${p.picked_up_by}` : ""} · {cuando(p.picked_up_at, lang)}</div>}
                    {p.delivered_at && <div className="hint" data-entregado style={{ margin: "2px 0 0" }}>{t("Delivered", "Entregado")}{p.delivered_by ? ` · ${p.delivered_by}` : ""} · {cuando(p.delivered_at, lang)}</div>}
                    {editable && fila && (
                      <CambiaElPaso paso={fila} minimo={primerDiaDelPasoB(anterior?.delivery_date, hoy)} choferes={choferes} lang={lang} t={t}
                        guardar={async (cambio) => { const ok = await updateDelivery(fila.id, cambio); if (ok) notify(t("Step updated.", "Paso actualizado.")); return ok; }} />
                    )}
                  </div>
                );
              })}
            </div>
            {avisos.map((a) => <p key={a.tipo + a.ids.join()} className="hint" data-aviso-de-relevo={a.tipo} style={{ color: "var(--amber-text)", margin: "8px 0 0" }}>⚠ {a[lang]}</p>)}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {puede && sePuedeDeshacer(familia) && (
                <button type="button" className="btn btn-danger" data-deshacer-relevo style={{ minHeight: 44 }} disabled={guardando} onClick={() => void deshacer()}>
                  ↶ {t("Undo the relay", "Deshacer el relevo")}
                </button>
              )}
              <button type="button" className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} disabled={guardando} onClick={cerrar}>{t("Close", "Cerrar")}</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Los avisos de los relevos de un conjunto de órdenes, para el Gestor de Rutas (D-NEXT): el paso b agendado antes que el a,
 * la recogida del b delante de la entrega del a en la misma ruta, y los dos pasos el mismo día en rutas distintas (el motor
 * de rutas ordena cada ruta por su cuenta y no garantiza ese orden). Nada si no hay ninguno.
 */
export function AvisosDeRelevo({ ordenes }: { ordenes: readonly Delivery[] }) {
  const { lang } = usePrefs();
  const avisos = useMemo(() => avisosDeRelevo(ordenes.filter(esPasoDeRelevo)), [ordenes]);
  if (!avisos.length) return null;
  return (
    <div data-avisos-de-relevo role="status" style={{ border: "1px solid var(--amber)", background: "var(--amber-soft)", color: "var(--amber-text)", borderRadius: 10, padding: "8px 12px", margin: "8px 0", display: "grid", gap: 4, fontSize: 13 }}>
      {avisos.map((a) => <span key={a.tipo + a.ids.join()} data-aviso-de-relevo={a.tipo}>⚠ ⇄ {a[lang]}</span>)}
    </div>
  );
}

/** El día y el chofer de un paso que aún no salió (el b), para quien planifica. Guarda con la escritura normal de la orden. */
function CambiaElPaso({ paso, minimo, choferes, lang, t, guardar }: {
  paso: Delivery; minimo: string; choferes: string[]; lang: "en" | "es";
  t: (en: string, es: string) => string;
  guardar: (cambio: Partial<Delivery>) => Promise<boolean>;
}) {
  const [fecha, setFecha] = useState((paso.delivery_date ?? "").slice(0, 10));
  const [chofer, setChofer] = useState(paso.assigned_driver ?? "");
  const [guardando, setGuardando] = useState(false);
  const cambio: Partial<Delivery> = {};
  if (fecha && fecha !== (paso.delivery_date ?? "").slice(0, 10)) cambio.delivery_date = fecha;
  if (chofer !== (paso.assigned_driver ?? "")) cambio.assigned_driver = chofer || null;
  const hayCambio = Object.keys(cambio).length > 0;
  const antes = !!fecha && fecha < minimo;
  return (
    <div data-cambia-el-paso style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginTop: 8 }}>
      <label style={{ display: "grid", gap: 2, fontSize: 12 }}>{t("Pickup day", "Día de recogida")}
        <input type="date" data-dia-del-paso value={fecha} min={minimo} onChange={(e) => setFecha(e.target.value)} />
      </label>
      <label style={{ display: "grid", gap: 2, fontSize: 12 }}>{t("Driver", "Chofer")}
        <select data-chofer-del-paso value={chofer} onChange={(e) => setChofer(e.target.value)}>
          <option value="">{t("Not assigned", "Sin asignar")}</option>
          {choferes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary btn-sm" data-guardar-el-paso disabled={!hayCambio || antes || guardando}
        onClick={async () => { setGuardando(true); await guardar(cambio); setGuardando(false); }}>
        {guardando ? t("Saving…", "Guardando…") : t("Save", "Guardar")}
      </button>
      {antes && <span className="hint" style={{ color: "var(--red)", margin: 0 }}>{lang === "es" ? "No puede ser antes que el paso anterior ni antes de hoy." : "It can't be before the previous step or before today."}</span>}
    </div>
  );
}
