"use client";

import { useState } from "react";
import { maxFechaDeEntrega } from "@/lib/dia-de-entrega";
import { fechaPropuesta } from "@/lib/reprogramar-orden";
import { resumenDeReprogramarVarias, separaParaReprogramar } from "@/lib/reprogramar-varias";
import { orderOwner, todayISO } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

/**
 * «📅 Reprogramar N» en la barra de seleccionadas del Gestor (D-994): una fecha para todas las marcadas, o «Fecha pendiente».
 * Cada una se guarda como la de una sola fila: con fecha, por `reprogramarOrden` (la función de la base, 173, que deja la
 * nota en el historial); sin fecha, quitando el día y anotándolo (el camino de «Fecha pendiente», D-972).
 */
export function ReprogramarVarias({ marcadas, rol, meId, lang, t, reprogramarOrden, updateDelivery, addNote, notify, onListo }: {
  marcadas: readonly Delivery[];
  rol: string | null | undefined;
  meId: string | null | undefined;
  lang: "en" | "es";
  t: (en: string, es: string) => string;
  reprogramarOrden: (id: string, fecha: string, nota: string, lang: "en" | "es") => Promise<boolean>;
  updateDelivery: (id: string, patch: Partial<Delivery>) => Promise<unknown>;
  addNote: (id: string, nota: string) => unknown;
  notify: (msg: string) => void;
  onListo: () => void;
}) {
  const hoy = todayISO();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(() => fechaPropuesta(marcadas[0]?.delivery_date ?? null, hoy));
  const [pendiente, setPendiente] = useState(false);
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const destino = pendiente ? null : fecha;
  const { pueden, saltadas } = separaParaReprogramar(marcadas, destino, rol, (d) => !!meId && orderOwner(d) === meId);
  const valida = (pendiente || /^\d{4}-\d{2}-\d{2}$/.test(fecha)) && nota.trim().length > 0 && pueden.length > 0;

  const guardar = async () => {
    if (!valida || guardando) return;
    setGuardando(true);
    let movidas = 0, fallidas = 0;
    for (const d of pueden) {
      let ok: unknown;
      if (destino) ok = await reprogramarOrden(d.id, destino, nota.trim(), lang);
      else {
        ok = await updateDelivery(d.id, { delivery_date: null });
        if (ok !== false) addNote(d.id, `Delivery date set to pending (bulk reschedule from Routes Manager): ${nota.trim()}`);
      }
      if (ok === false) fallidas++; else movidas++;
    }
    setGuardando(false);
    const r = resumenDeReprogramarVarias({
      movidas, fallidas,
      porEtapa: saltadas.filter((s) => s.motivo === "etapa").length,
      mismaFecha: saltadas.filter((s) => s.motivo === "misma_fecha").length,
    }, destino);
    notify(t(r.en, r.es));
    setAbierto(false);
    setNota("");
    if (movidas) onListo();
  };

  if (!abierto) {
    return (
      <button className="btn btn-sm" data-abre-reprogramar-varias disabled={!marcadas.length} onClick={() => setAbierto(true)}
        title={t("Give all the checked orders a new delivery date at once", "Dar a todas las marcadas una nueva fecha de entrega de una vez")}>
        📅 {t(`Reschedule ${marcadas.length}`, `Reprogramar ${marcadas.length}`)}
      </button>
    );
  }
  return (
    <div data-reprogramar-varias style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", width: "100%", marginTop: 6 }}>
      <b>📅 {t(`Reschedule ${marcadas.length}`, `Reprogramar ${marcadas.length}`)}</b>
      <input id="reprogramar-varias-fecha" type="date" value={pendiente ? "" : fecha} disabled={pendiente || guardando} min={hoy} max={maxFechaDeEntrega()}
        onChange={(e) => setFecha(e.target.value)} aria-label={t("New delivery date", "Nueva fecha de entrega")} />
      <label style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0, textTransform: "none", letterSpacing: "normal" }}>
        <input id="reprogramar-varias-pendiente" type="checkbox" checked={pendiente} disabled={guardando} onChange={(e) => setPendiente(e.target.checked)} />
        {t("Pending Delivery Date (no date)", "Fecha pendiente (sin día)")}
      </label>
      <input id="reprogramar-varias-nota" type="text" value={nota} disabled={guardando} onChange={(e) => setNota(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }}
        placeholder={t("Why? (saved in each order's history)", "¿Por qué? (se guarda en el historial de cada orden)")} />
      <button className="btn btn-primary btn-sm" data-reprograma-varias disabled={!valida || guardando} onClick={() => void guardar()}>
        {guardando ? t("Saving…", "Guardando…") : t(`Reschedule ${pueden.length}`, `Reprogramar ${pueden.length}`)}
      </button>
      <button className="btn btn-ghost btn-sm" disabled={guardando} onClick={() => setAbierto(false)}>{t("Cancel", "Cancelar")}</button>
      {saltadas.length > 0 && (
        <span className="hint" data-saltadas style={{ margin: 0, width: "100%" }}>
          {t(`${saltadas.length} will be skipped: delivered, canceled, not allowed for your role, or already on that date.`,
            `${saltadas.length} se saltarán: entregadas, anuladas, no permitidas para su rol, o ya en esa fecha.`)}
        </span>
      )}
    </div>
  );
}
