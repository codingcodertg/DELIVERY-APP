"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { CerrarAviso } from "@/components/CerrarAviso";
import { AVISOS_DEL_GESTOR } from "@/lib/avisos-ocultos";
import { useConfirm } from "@/lib/confirm";
import { useData } from "@/lib/data-provider";
import { idDeLaOrden, nombraLaOrden } from "@/lib/route-plan/etiqueta";
import { ETAPAS_RUTEABLES } from "@/lib/route-plan/publicar";
import { ordenesDelDia } from "@/lib/ordenes-del-dia";
import { RutaDelPlan, type ColumnasDeLaRuta } from "@/components/RutaDelPlan";
import { PrecisionDelPlan } from "@/components/PrecisionDelPlan";
import { ComparaConLaHoja } from "@/components/ComparaConLaHoja";
import type { RutaVista } from "@/lib/route-plan/vista";
import type { Movimiento } from "@/lib/route-plan/ajuste";
import type { CopiaDelPublicado } from "@/lib/route-plan/copia";
import { ordenDeLaParte } from "@/lib/route-plan/publicar";
import { fraseDePrioridadFuera, fraseDeRequisitoFuera, type FueraConPorque, type PorQue } from "@/lib/route-plan/porque";

/**
 * «Planificar el día» con el motor nuevo, y «Publicar ruta» (D-320). Solo admin y logística.
 *
 * **Convive con el Gestor de Rutas de hoy, que sigue entero debajo.** Planificar deja un BORRADOR: no toca
 * ninguna orden ni avisa a nadie. Publicar lo escribe en las órdenes —las mismas cuatro columnas que escribe el
 * Gestor— y avisa a cada chofer una sola vez.
 *
 * Aquí no se decide nada: qué entra al plan, qué se escribe y a quién se avisa vive en `src/lib/route-plan/`
 * y en la base (133). Esto llama a las dos rutas y enseña lo que contestan: el resumen, y debajo la ruta de
 * cada chofer parada a parada (`RutaDelPlan`).
 *
 * Al abrir, y al cambiar de fecha, se lee el plan vigente de esa fecha —el último borrador o publicado—, así
 * que un plan no se pierde por recargar la página.
 */

type Resumen = {
  paradas: number; ordenes: number; minutos: number; millas: number; tarde: number; proveedor: string; trafico: boolean; convergio: boolean;
  sinAsignar: { orden: string; motivo: string }[]; fuera: { id: string; motivo: string }[]; choferesFuera: { id: string; nombre: string; motivo: string }[];
  partes: Record<string, string[]>; tiempos: { presupuestoAgotado: boolean }; traficoSinResolver?: boolean;
  violaciones?: { tipo: string; chofer: string; orden?: string }[]; tramosSinTrafico?: number; fueraConPorque?: FueraConPorque[];
};

/** Qué se puede hacer con una orden que quedó fuera: el siguiente paso, no el motivo. */
const REMEDIO: Record<string, [string, string]> = {
  // Requisitos del camión (D-418): lo que pide la orden no lo tiene ningún chofer que rutea hoy.
  dar_requisito: ["Mark it on a driver's truck (Settings → Route engine → Drivers), or take it off the order.", "Márquelo en el camión de un chofer (Ajustes → Motor de rutas → Choferes), o quíteselo a la orden."],
  poner_pin: ["Open the order and set its map pin.", "Abra la orden y póngale el pin en el mapa."],
  revisar_choferes: ["Check who routes today (Settings → drivers) and who is off.", "Revise quién rutea hoy (Ajustes → choferes) y quién no está."],
  partir_o_camion_mayor: ["It doesn't fit any truck: raise a truck's capacity or split the order.", "No cabe en ningún camión: suba la capacidad de uno o parta la orden."],
  cambiar_ventana: ["Its window can't be met today: agree another window with the customer.", "Hoy no se llega a su ventana: acuerde otra con el cliente."],
  otro_dia_o_mas_choferes: ["The day is full: move it to another day or add a driver.", "El día está lleno: pásela a otro día o sume un chofer."],
  cambiar_chofer_fijado: ["Its assigned driver can't take it: clear the driver on the order and plan again.", "Su chofer asignado no puede llevarla: quítele el chofer a la orden y planifique de nuevo."],
  quitar_del_carril: ["It's in a manual lane on purpose. Clear its lane to let the engine route it.", "Está en un carril manual a propósito. Quítela del carril para que el motor la rutee."],
};
type Borrador = { plan_id: string; version: number; status: "draft" | "published"; published_at?: string | null; warnTiendasMarcadas: boolean; resumen: Resumen; rutas: RutaVista[]; choferes?: { id: string; nombre: string }[]; porque?: Record<string, PorQue>;
  /** Solo al planificar (D-414): «base», el plan respetó los candados 🔒 compartidos; «sin_tabla», no los conoce (falta la 149). */
  candados?: "base" | "sin_tabla";
  /** Solo en la copia de un plan publicado que se está cambiando (D-429): de qué versión salió, qué no se reescribe y qué cambió. */
  copia?: CopiaDelPublicado | null };

/** Lo que un ajuste a mano incumple. Se avisa; no impide publicar. */
const INCUMPLE: Record<string, [string, string]> = {
  precedencia: ["delivered before picked up", "se entrega antes de recogerse"], capacidad: ["over the truck's capacity", "pasa la capacidad del camión"],
  ventana_estrecha: ["misses its hard window", "no llega a su ventana dura"], retraso_sobre_el_tope: ["later than the allowed delay", "más tarde que el retraso permitido"],
  fuera_de_turno: ["outside the driver's shift", "fuera del turno del chofer"], sin_tiempo_de_viaje: ["no travel time for a leg", "falta el tiempo de viaje de un tramo"],
};
const NO_SE_PUEDE: Record<string, [string, string]> = {
  entrega_antes_de_recoger: ["An order can't be delivered before it's picked up.", "Una orden no se puede entregar antes de recogerla."],
  en_el_borde: ["That stop is already at the end.", "Esa parada ya está en el extremo."], ya_esta_ahi: ["It's already on that driver.", "Ya está con ese chofer."],
  ya_no_se_mueve:["That order is no longer pending that day (picked up, delivered, canceled or moved): it stays where it is.", "Esa orden ya no está pendiente ese día (recogida, entregada, anulada o movida): se queda donde está."],
};

/** Por qué la base dijo que el plan está viejo, orden a orden. */
const VIEJO: Record<string, [string, string]> = {
  cambio: ["was edited after planning", "se editó después de planificar"],
  fuera_de_etapa: ["is no longer in a routable stage", "ya no está en una etapa que se rutea"],
  no_esta: ["you can't see this order, or it no longer exists", "no ve esta orden, o ya no existe"],
};

const MOTIVOS: Record<string, [string, string]> = {
  sin_punto: ["no map point", "sin punto en el mapa"], sin_chofer_disponible: ["no driver available", "sin chofer disponible"],
  supera_capacidad: ["larger than any truck", "mayor que cualquier camión"], ventana_imposible: ["hard window can't be met", "no se llega a su ventana dura"],
  retraso_sobre_el_tope: ["would be too late", "llegaría demasiado tarde"], fuera_de_turno: ["doesn't fit in a shift", "no cabe en un turno"],
  chofer_fijado_sin_hueco: ["its driver has no room", "su chofer no tiene hueco"], no_cabe_con_el_resto: ["no room left today", "hoy no queda sitio"],
  en_un_carril_manual: ["in a manual lane", "en un carril manual"], chofer_no_rutea: ["its driver isn't routed today", "su chofer hoy no rutea"],
  no_rutea: ["not routed", "no rutea"], base: ["no base store", "sin tienda base"], base_sin_punto: ["base store has no map point", "su tienda base no tiene punto"],
  no_disponible: ["off today", "hoy no está"],
  // 🔒 (149, D-414): la ruta está bloqueada ese día; el motor no la toca.
  ruta_bloqueada: ["route locked 🔒", "ruta bloqueada 🔒"], en_ruta_bloqueada: ["on a locked route 🔒, left as it is", "en una ruta bloqueada 🔒, se queda como está"],
};

/** `onPublicado`: se llama tras publicar con éxito, para que la página relea el plan publicado (las etiquetas P/D de la tabla).
 *  `onCerrar`: si viene, la barra lleva la ✕ que la cierra para esta persona (D-400); la página decide qué es cerrar.
 *  `naceAbierto`: la barra nace desplegada — cuando se llega a ella desde el botón «🧭 Armar rutas» de la cabecera. */
export function PlanDelDia({ date, onPublicado, onCerrar, onAbrirOrden, naceAbierto = false, columnas }: { date: string; onPublicado?: () => void; onCerrar?: () => void; naceAbierto?: boolean; onAbrirOrden?: (id: string) => void;
  /** Las columnas de la tabla de paradas (D-429): las elige la persona en el ⚙ que pone la página, como el resto del Gestor. */
  columnas?: Omit<ColumnasDeLaRuta, "orden"> }) {
  const { lang, t } = usePrefs();
  const { deliveries, notify } = useData();
  const confirmAction = useConfirm();
  const [ocupado, setOcupado] = useState<"planificando" | "publicando" | "ajustando" | null>(null);
  const [abierto, setAbierto] = useState(naceAbierto);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicado, setPublicado] = useState<{ escritas: number; avisos: number } | null>(null);
  // Choferes de ESTE borrador que nunca han entrado a la app: no verán el aviso ni su ruta. Aviso, no bloqueo.
  const [sesiones, setSesiones] = useState<{ plan_id: string; choferes: { driver_id: string; nombre: string; ha_entrado: boolean | null }[] } | null>(null);

  const lee = useCallback(async () => {
    try {
      const res = await fetch(`/api/route-plan?date=${encodeURIComponent(date)}`);
      const b = await res.json().catch(() => ({}));
      setBorrador(res.ok && b.ok && b.plan ? (b.plan as Borrador) : null);
    } catch { /* sin red: se queda como estaba; planificar lo dirá */ }
  }, [date]);
  useEffect(() => { setBorrador(null); setError(null); setPublicado(null); void lee(); }, [lee]);

  const idDelBorrador = borrador?.status === "draft" ? borrador.plan_id : null;
  useEffect(() => {
    if (!idDelBorrador) return;
    let vivo = true;
    fetch("/api/route-plan/drivers-seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: idDelBorrador }) })
      .then((res) => (res.ok ? res.json() : null))
      .then((b) => { if (vivo && b?.ok) setSesiones({ plan_id: b.plan_id, choferes: b.choferes }); })
      .catch(() => undefined);      // si no se puede saber, no se avisa de nada que no se sabe
    return () => { vivo = false; };
  }, [idDelBorrador]);
  // Solo vale lo que se preguntó por ESTE plan: tras ajustar o replanificar, el id cambia.
  const delPlan = sesiones && sesiones.plan_id === idDelBorrador ? sesiones.choferes : [];
  const nuncaEntraron = delPlan.filter((c) => c.ha_entrado === false);

  // Cuántas órdenes ruteables tiene esta fecha: las mismas que leería «planificar» (misma función, mismas etapas).
  const sinPlan = ordenesDelDia(deliveries, date, "dia", ETAPAS_RUTEABLES).length;
  // La orden de cada parada, para las columnas de Órdenes (D-429). Una parte «id#b» es la orden «id».
  const porId = useMemo(() => new Map(deliveries.map((d) => [d.id, d])), [deliveries]);
  const ordenDeLaParada = (ref: string) => porId.get(ordenDeLaParte(ref));

  const motivo = (m: string) => (MOTIVOS[m] ? MOTIVOS[m][lang === "es" ? 1 : 0] : m);
  // Código Y factura, leídos en vivo de la orden: vale para las paradas, «Fuera de este plan» y la hoja.
  const nombreDeOrden = (id: string) => nombraLaOrden(deliveries, id, lang === "es");
  // Solo el id, para la columna ID del plan (D-NEXT): la factura va en su columna.
  const idDeOrden = (id: string) => idDeLaOrden(deliveries, id);

  const planifica = async () => {
    setOcupado("planificando"); setError(null); setPublicado(null);
    try {
      const res = await fetch("/api/route-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) { setError(String(b.error ?? res.status)); setBorrador(null); } else setBorrador(b as Borrador);
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(null);
  };

  // Un PUBLICADO también se ajusta (D-429): el servidor hace una copia en borrador y el publicado no se toca.
  const ajusta = async (movimiento: Movimiento) => {
    if (!borrador || !["draft", "published"].includes(borrador.status) || ocupado) return;
    setOcupado("ajustando"); setError(null);
    try {
      const res = await fetch("/api/route-plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: borrador.plan_id, movimiento }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) {
        const porQue = NO_SE_PUEDE[String(b.detail)];
        setError(porQue ? porQue[lang === "es" ? 1 : 0]
          : b.error === "DRAFT_EXISTS" ? t("Someone already made a newer draft for this date: here it is.", "Alguien ya hizo un borrador más nuevo de esta fecha: aquí está.")
          : String(b.error ?? res.status));
        if (res.status === 404 || res.status === 409) void lee();      // otro lo cambió: enseñar lo que hay
      } else setBorrador(b as Borrador);
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(null);
  };

  const publica = async () => {
    if (!borrador) return;
    const r = borrador.resumen;
    const fuera = r.sinAsignar.length + r.fuera.length;
    const avisos = r.violaciones?.length ?? 0;
    const ok = await confirmAction(t(
      `Publish this route? ${r.ordenes} order(s) will be assigned and each driver gets one notice.${fuera ? ` ${fuera} order(s) stay out of this plan and are not touched.` : ""}${avisos ? ` This plan has ${avisos} warning(s).` : ""}${nuncaEntraron.length ? ` ${nuncaEntraron.length} of ${delPlan.length} driver(s) have never signed in to the app: they won't see the notice or their route.` : ""}`,
      `¿Publicar esta ruta? Se asignarán ${r.ordenes} orden(es) y cada chofer recibirá un aviso.${fuera ? ` ${fuera} orden(es) quedan fuera de este plan y no se tocan.` : ""}${avisos ? ` Este plan tiene ${avisos} aviso(s).` : ""}${nuncaEntraron.length ? ` ${nuncaEntraron.length} de ${delPlan.length} chofer(es) no han entrado nunca a la app: no verán el aviso ni su ruta.` : ""}`,
    ), { danger: false, confirmLabel: t("Publish route", "Publicar ruta") });
    if (!ok) return;
    setOcupado("publicando"); setError(null);
    try {
      const res = await fetch("/api/route-plan/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: borrador.plan_id }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) {
        const viejas = b.error === "STALE" && Array.isArray(b.detail) ? (b.detail as { id: string; motivo: string }[]) : [];
        const cuales = viejas.map((v) => `${nombreDeOrden(v.id)}: ${VIEJO[v.motivo] ? VIEJO[v.motivo][lang === "es" ? 1 : 0] : v.motivo}`).join(" · ");
        setError(b.error === "STALE" ? `${t("This plan is out of date, so it wasn't published. Plan the day again.", "Este plan quedó viejo, así que no se publicó. Planifique el día de nuevo.")}${cuales ? ` (${cuales})` : ""}`
          : b.error === "UNSEEN" ? t("You can't see some of this plan's orders, so it wasn't published.", "No ve algunas órdenes de este plan, así que no se publicó.")
          // 🔒 Alguien bloqueó una ruta después de planificar (D-414): el plan la tocaría. Se dice cuáles y se replanifica.
          : b.error === "ROUTE_LOCKED" && Array.isArray(b.detail) ? `${t("A route in this plan was locked 🔒 after planning, so it wasn't published. Plan the day again.", "Una ruta de este plan se bloqueó 🔒 después de planificar, así que no se publicó. Planifique el día de nuevo.")} (${(b.detail as { id: string; ruta: string }[]).map((c) => `${nombreDeOrden(c.id)} → ${c.ruta}`).join(" · ")})`
          : String(b.error ?? res.status));
      } else {
        const avisos = (b.notifications ?? []) as { notification_id: string }[];
        // El push es un extra sobre la campana: si falla, la ruta está publicada igual.
        for (const a of avisos) void fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notification_id: a.notification_id }) }).catch(() => undefined);
        setPublicado({ escritas: Number(b.written ?? 0), avisos: avisos.length });
        void lee();
        onPublicado?.();
        notify(t("Route published", "Ruta publicada"));
      }
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(null);
  };

  const r = borrador?.resumen;
  // Plegado tras un botón (D-346). El dueño: «build todays load automatically will be a button so it hides all that
  // information and just shows when i want it to». D-334 lo había hecho imposible de no ver porque entonces no lo
  // encontraba; ahora lo conoce y le estorba. Plegado sigue diciendo lo que importa: cuántas órdenes no tienen plan.
  if (!abierto) return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button className="btn btn-ghost btn-sm" aria-expanded={false} onClick={() => setAbierto(true)}>🧭 {t("Build today's routes automatically", "Armar las rutas del día automáticamente")} ▸</button>
      {!borrador && sinPlan > 0 && <span className="sema" style={{ border: "1px solid var(--amber)", color: "var(--amber-text)" }}>{t(`${sinPlan} order(s) on this date with no plan`, `${sinPlan} orden(es) de esta fecha sin plan`)}</span>}
      {borrador && <span className="hint" style={{ margin: 0 }}>{borrador.status === "published" ? t(`Published v${borrador.version}`, `Publicado v${borrador.version}`) : t(`Draft v${borrador.version}`, `Borrador v${borrador.version}`)}</span>}
      {onCerrar && <CerrarAviso aviso={AVISOS_DEL_GESTOR.armarRutas} onCerrar={onCerrar} />}
    </div>
  );
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* Que no se pueda no ver (D-334): el dueño buscaba P1, P2… D1, D2… y no había pulsado esto nunca. El título dice
            lo que HACE, la frase lo que DA, y sin plan el botón es el primario de la pantalla. «Motor nuevo» era jerga nuestra. */}
        <button className="btn btn-ghost btn-sm" aria-expanded onClick={() => setAbierto(false)} title={t("Hide", "Ocultar")}><b>🧭 {t("Build today's routes automatically", "Armar las rutas del día automáticamente")}</b> ▾</button>
        {onCerrar && <CerrarAviso aviso={AVISOS_DEL_GESTOR.armarRutas} onCerrar={onCerrar} />}
        {!borrador && sinPlan > 0 && <span className="sema" style={{ border: "1px solid var(--amber)", color: "var(--amber-text)" }}>{t(`${sinPlan} order(s) on this date with no plan`, `${sinPlan} orden(es) de esta fecha sin plan`)}</span>}
        <span className="hint" style={{ margin: 0, flexBasis: "100%" }}>
          {t("Splits this date's orders among the drivers and sequences pickups (P1, P2…) and deliveries (D1, D2…) with estimated times. It's a draft: nothing is assigned until you publish.",
             "Reparte las órdenes de esta fecha entre los choferes y ordena recogidas (P1, P2…) y entregas (D1, D2…) con horas estimadas. Es un borrador: nada se asigna hasta publicar.")}
        </span>
        <span style={{ flex: 1 }} />
        <button className={borrador ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"} disabled={!!ocupado} onClick={() => void planifica()}>
          {ocupado === "planificando" ? t("Planning…", "Planificando…") : borrador?.status === "draft" ? t("Plan again", "Planificar de nuevo") : t("Plan the day", "Planificar el día")}
        </button>
        {borrador?.status === "draft" && (
          <button className="btn btn-primary btn-sm" disabled={!!ocupado || r!.ordenes === 0} onClick={() => void publica()}>
            {ocupado === "publicando" ? t("Publishing…", "Publicando…") : t("Publish route", "Publicar ruta")}
          </button>
        )}
      </div>

      {error && <div className="hint" style={{ color: "var(--red)", marginTop: 8 }}>{error}</div>}
      {publicado && <div className="hint" style={{ marginTop: 8 }}>{t(`Published: ${publicado.escritas} order(s) assigned, ${publicado.avisos} driver(s) notified.`, `Publicada: ${publicado.escritas} orden(es) asignadas, ${publicado.avisos} chofer(es) avisados.`)}</div>}

      {r && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <div>
            <b>{borrador!.status === "published" ? t(`Published v${borrador!.version}`, `Publicado v${borrador!.version}`) : t(`Draft v${borrador!.version}`, `Borrador v${borrador!.version}`)}</b> · {r.ordenes} {t("orders", "órdenes")} · {r.paradas} {t("stops", "paradas")} · {Math.floor(r.minutos / 60)} h {r.minutos % 60} min · {r.millas} mi
            {r.tarde > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)", marginLeft: 8 }}>{r.tarde} {t("min late", "min tarde")}</span>}
          </div>
          <div className="hint" style={{ margin: 0 }}>
            {r.proveedor === "estimado" ? t("⚠ Travel times are ESTIMATED (straight line): the map services did not answer.", "⚠ Los tiempos son ESTIMADOS (línea recta): los servicios de mapas no contestaron.")
              : r.proveedor === "osrm" ? t("⚠ Travel times without traffic (backup service).", "⚠ Tiempos sin tráfico (servicio de respaldo).")
              : r.trafico ? t("Travel times with traffic.", "Tiempos con tráfico.") : t("Travel times without traffic.", "Tiempos sin tráfico.")}
            {r.tiempos.presupuestoAgotado && ` ${t("The daily map-call limit was reached.", "Se llegó al tope diario de llamadas al mapa.")}`}
            {r.traficoSinResolver && ` ${t("With traffic, something still doesn't fit: look at the late stops below.", "Con tráfico, algo sigue sin caber: mire las paradas tarde abajo.")}`}
            {!r.convergio && ` ${t("The plan was cut short before it stopped improving.", "El plan se cortó antes de dejar de mejorar.")}`}
          </div>
          {borrador!.warnTiendasMarcadas && (
            <div className="hint" style={{ margin: 0, color: "var(--red)" }}>{t("Your account only sees some stores, so you may not be able to publish every order.", "Su cuenta solo ve algunas tiendas, así que puede que no logre publicar todas las órdenes.")}</div>
          )}
          {(r.fueraConPorque?.length ?? 0) > 0 && (
            <div>
              <b>{t("Left out of this plan", "Fuera de este plan")} ({r.fueraConPorque!.length}):</b>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {r.fueraConPorque!.map((x) => (
                  <li key={x.id}>
                    <b>{onAbrirOrden ? <button type="button" data-abrir-orden style={{ background: "none", border: 0, padding: 0, color: "var(--blue, #2563eb)", textDecoration: "underline", cursor: "pointer", font: "inherit" }} onClick={() => onAbrirOrden(x.id)}>{nombreDeOrden(x.id)}</button> : nombreDeOrden(x.id)}</b> — {fraseDeRequisitoFuera(x, lang) ?? motivo(x.motivo)}.
                    {fraseDePrioridadFuera(x, lang) && <> {fraseDePrioridadFuera(x, lang)}</>}
                    {REMEDIO[x.remedio] && <span className="hint" style={{ margin: 0 }}> {REMEDIO[x.remedio][lang === "es" ? 1 : 0]}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(r.partes).length > 0 && (
            <div className="hint" style={{ margin: 0 }}>
              {Object.entries(r.partes).map(([id, partes]) => t(`${nombreDeOrden(id)} is split into ${partes.length} loads; in Orders it stays a single order.`, `${nombreDeOrden(id)} se reparte en ${partes.length} cargas; en Órdenes figura una sola.`)).join(" ")}
            </div>
          )}
          {borrador?.candados === "sin_tabla" && (
            <div className="hint" data-plan-sin-candados style={{ margin: 0, color: "var(--amber-text)" }}>
              🔒 {t("This plan doesn't know about locked routes: locks are only kept in each browser until the database gets its table (migration 149).", "Este plan no conoce las rutas bloqueadas: los candados solo viven en cada navegador hasta que la base tenga su tabla (migración 149).")}
            </div>
          )}
          {r.choferesFuera.length > 0 && (
            <div className="hint" style={{ margin: 0 }}>{t("Not routed today", "Hoy no rutean")}: {r.choferesFuera.map((c) => `${c.nombre} (${motivo(c.motivo)})`).join(" · ")}</div>
          )}
          {nuncaEntraron.length > 0 && (
            <div className="hint" style={{ margin: 0, color: "var(--red)" }}>
              {t(`${nuncaEntraron.length} of ${delPlan.length} driver(s) in this plan have never signed in to the app: they won't see the notice or their route`, `${nuncaEntraron.length} de ${delPlan.length} chofer(es) de este plan no han entrado nunca a la app: no verán el aviso ni su ruta`)}
              {" "}({nuncaEntraron.map((c) => c.nombre).join(", ")}). {t("You can still publish.", "Se puede publicar igual.")}
            </div>
          )}
          {(r.violaciones?.length ?? 0) > 0 && (
            <div className="hint" style={{ margin: 0, color: "var(--red)" }}>
              <b>{t("Warnings (you can still publish)", "Avisos (se puede publicar igual)")}:</b>{" "}
              {r.violaciones!.map((v) => `${v.orden ? `${nombreDeOrden(v.orden)} ` : ""}${INCUMPLE[v.tipo] ? INCUMPLE[v.tipo][lang === "es" ? 1 : 0] : v.tipo}`).join(" · ")}
            </div>
          )}
          {(r.tramosSinTrafico ?? 0) > 0 && (
            <div className="hint" style={{ margin: 0 }}>{t(`${r.tramosSinTrafico} leg(s) changed by hand have no traffic data: their times are without traffic.`, `${r.tramosSinTrafico} tramo(s) cambiados a mano no tienen dato de tráfico: sus horas van sin tráfico.`)}</div>
          )}
          {borrador!.status === "published" && (
            <div className="hint" data-publicado-se-cambia style={{ margin: 0 }}>
              {t("You can still change this route with the arrows below: the first change makes a copy, and drivers get nothing until you publish it.", "Esta ruta se puede cambiar con las flechas de abajo: el primer cambio hace una copia, y los choferes no reciben nada hasta publicarla.")}
            </div>
          )}
          {borrador!.status === "draft" && borrador!.copia && (
            <div data-copia-del-publicado style={{ margin: 0, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--amber)", background: "var(--amber-soft)" }}>
              <b>{t(`You're editing a copy of published v${borrador!.copia.version}; publish it so the drivers receive it.`, `Estás editando una copia del publicado v${borrador!.copia.version}; publícala para que el chofer la reciba.`)}</b>
              {" "}{t(`Until then, drivers keep v${borrador!.copia.version}. Only drivers whose route changes get a notice.`, `Hasta entonces, los choferes siguen con la v${borrador!.copia.version}. Solo se avisa a los choferes a los que les cambie la ruta.`)}
              {borrador!.copia.noSeReescriben.length > 0 && (
                <div className="hint" style={{ margin: "4px 0 0" }}>🔒 {t("No longer pending that day, so they stay where they are and aren't rewritten", "Ya no están pendientes ese día: se quedan donde están y no se reescriben")}: {borrador!.copia.noSeReescriben.map(nombreDeOrden).join(" · ")}</div>
              )}
              {borrador!.copia.cambiaron.length > 0 && (
                <div className="hint" style={{ margin: "4px 0 0", color: "var(--red)" }}>
                  {t("Edited after publishing, so this copy won't publish: plan the day again", "Se editaron después de publicar, así que esta copia no se podrá publicar: planifique el día de nuevo")}: {borrador!.copia.cambiaron.map(nombreDeOrden).join(" · ")}
                </div>
              )}
            </div>
          )}
          <RutaDelPlan rutas={borrador!.rutas} idDeOrden={idDeOrden} abrirOrden={onAbrirOrden}
            columnas={columnas ? { ...columnas, orden: ordenDeLaParada } : undefined}
            ajuste={borrador!.status === "draft" || borrador!.status === "published" ? { choferes: borrador!.choferes ?? [], ocupado: !!ocupado, mueve: (m) => void ajusta(m), noSeMueven: new Set(borrador!.copia?.noSeReescriben ?? []) } : undefined} />
          {borrador!.status === "published" && <PrecisionDelPlan date={date} />}
          <ComparaConLaHoja date={date} nombreDeOrden={nombreDeOrden} />
        </div>
      )}
    </div>
  );
}
