"use client";

import { useState, type ReactNode } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { stageLabel } from "@/lib/constants";
import { suggestDeliveryFee } from "@/lib/pricing";
import { orderLabel } from "@/lib/utils";
import { motivosDeAnulacion } from "@/lib/cancel-reasons";
import { ordenDeMisTiendas } from "@/lib/deshacer-y-borrar";
import { escribeComenzar, escribeListo } from "@/lib/pasos-de-bodega";
import { notaDelSalto, saltosEnLaFila, type SaltoDeEtapa } from "@/lib/etapas-en-la-fila";
import { ConfirmarTarifaAlComenzar } from "@/components/ConfirmarTarifaAlComenzar";
import { ConfirmarPallets } from "@/components/ConfirmarPallets";
import { ConfirmarAnulacion } from "@/components/ConfirmarAnulacion";
import { MotivoDelSalto } from "@/components/MotivoDelSalto";
import { IconoDeFotos } from "@/components/IconoDeFotos";
import type { Pastilla } from "@/lib/recibir";
import type { Delivery } from "@/lib/types";

/**
 * La celda de «Etapa» de Almacén (D-573): la burbuja de color de siempre que, donde esta persona puede mover esa orden,
 * es también un `<select>` —superficie transparente encima de la burbuja, al estilo de `.role-switch`— con TODAS las
 * etapas a las que la base le deja llevarla, la actual marcada. El dueño, 2026-10-16: «Remove next step column and have
 * the stage column do that dropdown function. Dropdown should give all stage options not just the next one. […] Also
 * want to keep the colored bubble design».
 *
 * Qué ofrece cada fila lo decide `saltosEnLaFila`. Al elegir:
 *  - si el salto confirma algo, se abre EL MISMO diálogo de la ficha —tarifa (D-450), pallets (D-287), motivo de
 *    anulación (D-291), motivo de rechazo, o el motivo obligatorio de entregar ya / deshacer (D-361/D-383)— y lo que
 *    devuelve se escribe con la misma función que usa la ficha; cerrar el diálogo deja la etapa como estaba;
 *  - si no (comenzar una Intertienda, aprobar, desbloquear), se escribe ya.
 * Si la base rechaza, `setStage` avisa como hoy y la burbuja sigue en su etapa: el `<select>` es controlado y solo
 * cambia cuando cambia la orden.
 *
 * Devuelve la celda (para cada fila, recibe la pastilla que la tabla iba a pintar) y el diálogo (uno para toda la
 * página, fuera de la tabla: dentro de una celda quedaría recortado por la caja que se desplaza).
 */
export function useEtapaEnLaFila(): { celda: (d: Delivery, pastilla: Pastilla, burbuja: ReactNode) => ReactNode; dialogo: ReactNode } {
  const { me, settings, setStage, notify, realRole } = useData();
  const { lang, t } = usePrefs();
  const [abierto, setAbierto] = useState<{ pedido: Delivery; salto: SaltoDeEtapa } | null>(null);
  // La orden que se está guardando: su selector se apaga hasta que vuelve la escritura.
  const [guardando, setGuardando] = useState<string | null>(null);

  const hecho = (pedido: Delivery, salto: SaltoDeEtapa, detalle?: string) => {
    const etapa = stageLabel(salto.destino, lang);
    notify(`#${orderLabel(pedido)} → ${etapa}${detalle ? ` — ${detalle}` : ""}`);
  };

  const escribe = async (pedido: Delivery, salto: SaltoDeEtapa, escritura: () => Promise<boolean>, detalle?: string) => {
    setGuardando(pedido.id);
    const ok = await escritura();
    setGuardando(null);
    if (!ok) return;
    setAbierto(null);
    hecho(pedido, salto, detalle);
  };

  const elegir = (pedido: Delivery, salto: SaltoDeEtapa) => {
    if (salto.confirmacion) { setAbierto({ pedido, salto }); return; }
    // Sin confirmación: comenzar un tipo que no cobra (la escritura de la ficha sin diálogo), aprobar o desbloquear.
    if (salto.destino === "fulfilling") { void escribe(pedido, salto, () => escribeComenzar(setStage, pedido.id, null, t)); return; }
    void escribe(pedido, salto, () => setStage(pedido.id, salto.destino));
  };

  const celda = (d: Delivery, pastilla: Pastilla, burbuja: ReactNode): ReactNode => {
    if (!me) return burbuja;
    const saltos = saltosEnLaFila(me, d, settings.order_type_rules, ordenDeMisTiendas(d, me.store, settings.stores));
    if (saltos.length === 0) return burbuja;
    const ocupado = guardando === d.id;
    return (
      <span className="sema sema-switch" title={pastilla.texto} style={{ background: pastilla.color }} onClick={(e) => e.stopPropagation()}>
        {ocupado ? t("Saving…", "Guardando…") : <>{pastilla.texto}<IconoDeFotos p={pastilla} /></>} <span aria-hidden="true" style={{ opacity: .8 }}>▾</span>
        <select value={d.stage} disabled={ocupado}
          aria-label={t(`Stage of #${orderLabel(d)}`, `Etapa de #${orderLabel(d)}`)}
          onChange={(e) => {
            const salto = saltos.find((s) => s.destino === e.target.value);
            if (salto) elegir(d, salto);
          }}>
          <option value={d.stage}>{stageLabel(d.stage, lang)}</option>
          {saltos.map((s) => (
            <option key={s.destino} value={s.destino}>{stageLabel(s.destino, lang)}{s.confirmacion ? "…" : ""}</option>
          ))}
        </select>
      </span>
    );
  };

  let dialogo: ReactNode = null;
  if (abierto) {
    const { pedido, salto } = abierto;
    const ocupado = guardando === pedido.id;
    const cerrar = () => setAbierto(null);
    switch (salto.confirmacion) {
      case "tarifa":
        dialogo = (
          <ConfirmarTarifaAlComenzar pedido={pedido} sugerencia={suggestDeliveryFee(pedido, settings)} adminReal={realRole === "admin"} ocupado={ocupado}
            onCancelar={cerrar}
            onConfirmar={(escritura) => void escribe(pedido, salto, () => escribeComenzar(setStage, pedido.id, escritura, t), t(escritura.nota.en, escritura.nota.es))} />
        );
        break;
      case "pallets":
        dialogo = (
          <ConfirmarPallets pedido={pedido} ocupado={ocupado} onDescartar={cerrar}
            onConfirmar={(escritura) => void escribe(pedido, salto, () => escribeListo(setStage, pedido.id, escritura, t), t(escritura.nota.en, escritura.nota.es))}
            onInvalido={() => notify(t("Enter the confirmed pallet count.", "Ingrese la cantidad confirmada de pallets."))} />
        );
        break;
      case "anular":
        dialogo = (
          <ConfirmarAnulacion motivos={motivosDeAnulacion(settings)} ocupado={ocupado} onCancelar={cerrar}
            onConfirmar={(escritura) => void escribe(pedido, salto, () => setStage(pedido.id, "canceled", escritura.nota, escritura.extra), escritura.nota)} />
        );
        break;
      case "motivo_rechazo":
        dialogo = (
          <MotivoDelSalto titulo={t(`Reject #${orderLabel(pedido)}`, `Rechazar #${orderLabel(pedido)}`)} ocupado={ocupado} onCancelar={cerrar}
            placeholder={t("What needs to change?", "¿Qué se necesita cambiar?")} textoDelBoton={t("Confirm reject", "Confirmar rechazo")}
            onConfirmar={(motivo) => void escribe(pedido, salto, () => setStage(pedido.id, "rejected", motivo), motivo)} />
        );
        break;
      case "motivo_entrega":
      case "motivo_deshacer": {
        const clase = salto.confirmacion;
        dialogo = (
          <MotivoDelSalto ocupado={ocupado} onCancelar={cerrar}
            titulo={clase === "motivo_entrega"
              ? t(`Mark #${orderLabel(pedido)} delivered now`, `Marcar #${orderLabel(pedido)} entregada ya`)
              : t(`Undo stage of #${orderLabel(pedido)} → ${stageLabel(salto.destino, lang)}`, `Deshacer etapa de #${orderLabel(pedido)} → ${stageLabel(salto.destino, lang)}`)}
            placeholder={clase === "motivo_entrega"
              ? t("Why is it closed without a signature?", "¿Por qué se cierra sin firma?")
              : t("Why does it go back?", "¿Por qué vuelve atrás?")}
            textoDelBoton={clase === "motivo_entrega" ? t("Mark delivered", "Marcar entregada") : t("Undo stage", "Deshacer etapa")}
            onConfirmar={(motivo) => {
              const nota = notaDelSalto(clase, motivo);
              void escribe(pedido, salto, () => setStage(pedido.id, salto.destino, t(nota.en, nota.es)), motivo);
            }} />
        );
        break;
      }
    }
  }

  return { celda, dialogo };
}
