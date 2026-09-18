"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { useData } from "@/lib/data-provider";
import { orderLabel } from "@/lib/utils";
import { RutaDelPlan } from "@/components/RutaDelPlan";
import type { RutaVista } from "@/lib/route-plan/vista";
import type { Movimiento } from "@/lib/route-plan/ajuste";

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
  violaciones?: { tipo: string; chofer: string; orden?: string }[]; tramosSinTrafico?: number;
};
type Borrador = { plan_id: string; version: number; status: "draft" | "published"; published_at?: string | null; warnTiendasMarcadas: boolean; resumen: Resumen; rutas: RutaVista[]; choferes?: { id: string; nombre: string }[] };

/** Lo que un ajuste a mano incumple. Se avisa; no impide publicar. */
const INCUMPLE: Record<string, [string, string]> = {
  precedencia: ["delivered before picked up", "se entrega antes de recogerse"], capacidad: ["over the truck's capacity", "pasa la capacidad del camión"],
  ventana_estrecha: ["misses its hard window", "no llega a su ventana dura"], retraso_sobre_el_tope: ["later than the allowed delay", "más tarde que el retraso permitido"],
  fuera_de_turno: ["outside the driver's shift", "fuera del turno del chofer"], sin_tiempo_de_viaje: ["no travel time for a leg", "falta el tiempo de viaje de un tramo"],
};
const NO_SE_PUEDE: Record<string, [string, string]> = {
  entrega_antes_de_recoger: ["An order can't be delivered before it's picked up.", "Una orden no se puede entregar antes de recogerla."],
  en_el_borde: ["That stop is already at the end.", "Esa parada ya está en el extremo."], ya_esta_ahi: ["It's already on that driver.", "Ya está con ese chofer."],
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
};

export function PlanDelDia({ date }: { date: string }) {
  const { lang, t } = usePrefs();
  const { deliveries, notify } = useData();
  const confirmAction = useConfirm();
  const [ocupado, setOcupado] = useState<"planificando" | "publicando" | "ajustando" | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicado, setPublicado] = useState<{ escritas: number; avisos: number } | null>(null);

  const lee = useCallback(async () => {
    try {
      const res = await fetch(`/api/route-plan?date=${encodeURIComponent(date)}`);
      const b = await res.json().catch(() => ({}));
      setBorrador(res.ok && b.ok && b.plan ? (b.plan as Borrador) : null);
    } catch { /* sin red: se queda como estaba; planificar lo dirá */ }
  }, [date]);
  useEffect(() => { setBorrador(null); setError(null); setPublicado(null); void lee(); }, [lee]);

  const motivo = (m: string) => (MOTIVOS[m] ? MOTIVOS[m][lang === "es" ? 1 : 0] : m);
  const nombreDeOrden = (id: string) => { const d = deliveries.find((x) => x.id === id.split("#")[0]); return d ? `#${orderLabel(d)}` : id.slice(0, 8); };

  const planifica = async () => {
    setOcupado("planificando"); setError(null); setPublicado(null);
    try {
      const res = await fetch("/api/route-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) { setError(String(b.error ?? res.status)); setBorrador(null); } else setBorrador(b as Borrador);
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(null);
  };

  const ajusta = async (movimiento: Movimiento) => {
    if (!borrador || borrador.status !== "draft" || ocupado) return;
    setOcupado("ajustando"); setError(null);
    try {
      const res = await fetch("/api/route-plan", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: borrador.plan_id, movimiento }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) {
        const porQue = NO_SE_PUEDE[String(b.detail)];
        setError(porQue ? porQue[lang === "es" ? 1 : 0] : String(b.error ?? res.status));
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
      `Publish this route? ${r.ordenes} order(s) will be assigned and each driver gets one notice.${fuera ? ` ${fuera} order(s) stay out of this plan and are not touched.` : ""}${avisos ? ` This plan has ${avisos} warning(s).` : ""}`,
      `¿Publicar esta ruta? Se asignarán ${r.ordenes} orden(es) y cada chofer recibirá un aviso.${fuera ? ` ${fuera} orden(es) quedan fuera de este plan y no se tocan.` : ""}${avisos ? ` Este plan tiene ${avisos} aviso(s).` : ""}`,
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
          : String(b.error ?? res.status));
      } else {
        const avisos = (b.notifications ?? []) as { notification_id: string }[];
        // El push es un extra sobre la campana: si falla, la ruta está publicada igual.
        for (const a of avisos) void fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notification_id: a.notification_id }) }).catch(() => undefined);
        setPublicado({ escritas: Number(b.written ?? 0), avisos: avisos.length });
        void lee();
        notify(t("Route published", "Ruta publicada"));
      }
    } catch { setError(t("Network error.", "Error de red.")); }
    setOcupado(null);
  };

  const r = borrador?.resumen;
  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b>🧭 {t("Plan the day (new engine)", "Planificar el día (motor nuevo)")}</b>
        <span className="hint" style={{ margin: 0 }}>{t("Makes a draft. Nothing is assigned until you publish.", "Hace un borrador. Nada se asigna hasta publicar.")}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" disabled={!!ocupado} onClick={() => void planifica()}>
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
          {[...r.sinAsignar.map((s) => ({ id: s.orden, m: s.motivo })), ...r.fuera.map((f) => ({ id: f.id, m: f.motivo }))].length > 0 && (
            <div>
              <b>{t("Left out of this plan", "Fuera de este plan")}:</b>{" "}
              {[...r.sinAsignar.map((s) => ({ id: s.orden, m: s.motivo })), ...r.fuera.map((f) => ({ id: f.id, m: f.motivo }))].map((x) => `${nombreDeOrden(x.id)} (${motivo(x.m)})`).join(" · ")}
            </div>
          )}
          {Object.keys(r.partes).length > 0 && (
            <div className="hint" style={{ margin: 0 }}>
              {Object.entries(r.partes).map(([id, partes]) => t(`${nombreDeOrden(id)} is split into ${partes.length} loads; in Orders it stays a single order.`, `${nombreDeOrden(id)} se reparte en ${partes.length} cargas; en Órdenes figura una sola.`)).join(" ")}
            </div>
          )}
          {r.choferesFuera.length > 0 && (
            <div className="hint" style={{ margin: 0 }}>{t("Not routed today", "Hoy no rutean")}: {r.choferesFuera.map((c) => `${c.nombre} (${motivo(c.motivo)})`).join(" · ")}</div>
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
          <RutaDelPlan rutas={borrador!.rutas} nombreDeOrden={nombreDeOrden}
            ajuste={borrador!.status === "draft" ? { choferes: borrador!.choferes ?? [], ocupado: !!ocupado, mueve: (m) => void ajusta(m) } : undefined} />
        </div>
      )}
    </div>
  );
}
