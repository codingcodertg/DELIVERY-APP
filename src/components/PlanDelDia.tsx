"use client";

import { useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { useData } from "@/lib/data-provider";
import { orderLabel } from "@/lib/utils";

/**
 * «Planificar el día» con el motor nuevo, y «Publicar ruta» (D-NEXT). Solo admin y logística.
 *
 * **Convive con el Gestor de Rutas de hoy, que sigue entero debajo.** Planificar deja un BORRADOR: no toca
 * ninguna orden ni avisa a nadie. Publicar lo escribe en las órdenes —las mismas cuatro columnas que escribe el
 * Gestor— y avisa a cada chofer una sola vez.
 *
 * Aquí no se decide nada: qué entra al plan, qué se escribe y a quién se avisa vive en `src/lib/route-plan/`
 * y en la base (133). Esto llama a las dos rutas y enseña lo que contestan. La ruta P/D con sus horas llega en
 * el incremento siguiente; aquí va el resumen, que es lo que hace falta para decidir si se publica.
 */

type Resumen = {
  paradas: number; ordenes: number; minutos: number; millas: number; tarde: number; proveedor: string; trafico: boolean; convergio: boolean;
  sinAsignar: { orden: string; motivo: string }[]; fuera: { id: string; motivo: string }[]; choferesFuera: { id: string; nombre: string; motivo: string }[];
  partes: Record<string, string[]>; tiempos: { presupuestoAgotado: boolean };
};
type Borrador = { plan_id: string; version: number; warnTiendasMarcadas: boolean; resumen: Resumen };

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
  const [ocupado, setOcupado] = useState<"planificando" | "publicando" | null>(null);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicado, setPublicado] = useState<{ escritas: number; avisos: number } | null>(null);

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

  const publica = async () => {
    if (!borrador) return;
    const r = borrador.resumen;
    const fuera = r.sinAsignar.length + r.fuera.length;
    const ok = await confirmAction(t(
      `Publish this route? ${r.ordenes} order(s) will be assigned and each driver gets one notice.${fuera ? ` ${fuera} order(s) stay out of this plan and are not touched.` : ""}`,
      `¿Publicar esta ruta? Se asignarán ${r.ordenes} orden(es) y cada chofer recibirá un aviso.${fuera ? ` ${fuera} orden(es) quedan fuera de este plan y no se tocan.` : ""}`,
    ), { danger: false, confirmLabel: t("Publish route", "Publicar ruta") });
    if (!ok) return;
    setOcupado("publicando"); setError(null);
    try {
      const res = await fetch("/api/route-plan/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_id: borrador.plan_id }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok || !b.ok) {
        setError(b.error === "STALE" ? t("Orders changed since this plan was made. Plan the day again.", "Las órdenes cambiaron desde que se hizo este plan. Planifique el día de nuevo.")
          : b.error === "UNSEEN" ? t("You can't see some of this plan's orders, so it wasn't published.", "No ve algunas órdenes de este plan, así que no se publicó.")
          : String(b.error ?? res.status));
      } else {
        const avisos = (b.notifications ?? []) as { notification_id: string }[];
        // El push es un extra sobre la campana: si falla, la ruta está publicada igual.
        for (const a of avisos) void fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notification_id: a.notification_id }) }).catch(() => undefined);
        setPublicado({ escritas: Number(b.written ?? 0), avisos: avisos.length });
        setBorrador(null);
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
          {ocupado === "planificando" ? t("Planning…", "Planificando…") : borrador ? t("Plan again", "Planificar de nuevo") : t("Plan the day", "Planificar el día")}
        </button>
        {borrador && (
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
            {t(`Draft v${borrador!.version}`, `Borrador v${borrador!.version}`)} · {r.ordenes} {t("orders", "órdenes")} · {r.paradas} {t("stops", "paradas")} · {Math.floor(r.minutos / 60)} h {r.minutos % 60} min · {r.millas} mi
            {r.tarde > 0 && <span className="sema" style={{ border: "1px solid var(--red)", color: "var(--red)", marginLeft: 8 }}>{r.tarde} {t("min late", "min tarde")}</span>}
          </div>
          <div className="hint" style={{ margin: 0 }}>
            {r.proveedor === "estimado" ? t("⚠ Travel times are ESTIMATED (straight line): the map services did not answer.", "⚠ Los tiempos son ESTIMADOS (línea recta): los servicios de mapas no contestaron.")
              : r.proveedor === "osrm" ? t("⚠ Travel times without traffic (backup service).", "⚠ Tiempos sin tráfico (servicio de respaldo).")
              : r.trafico ? t("Travel times with traffic.", "Tiempos con tráfico.") : t("Travel times without traffic.", "Tiempos sin tráfico.")}
            {r.tiempos.presupuestoAgotado && ` ${t("The daily map-call limit was reached.", "Se llegó al tope diario de llamadas al mapa.")}`}
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
        </div>
      )}
    </div>
  );
}
