"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import {
  KIND_RECHAZADA, MOTIVOS_DE_RECHAZO, accionesDeParada, avisosDeRechazo, kindDeDeshacerLlegada, kindDeLlegada, notaDeRechazo,
  notaDelDestino, razonDeLaNota, razonDeRechazo, tiendaDelRechazo, type DestinoDelRechazo,
  type LlegadaDeParada, type MarcaDeParada,
} from "@/lib/acciones-parada";
import { escrituraDeshacerRecogida, type DeshacerRecogida } from "@/lib/recogida-del-chofer";
import { EVENTO_DEJADO, escrituraDejarEnTienda } from "@/lib/leave-at-store";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { botonesConLlegada } from "@/lib/siguiente-de-mi-ruta";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// Los botones de UNA orden de una parada en «Mi ruta» (D-487; D-520): qué sale lo decide `accionesDeParada`; aquí solo
// se pinta y se escribe. Rechazado deja un evento y no toca la etapa.
//
// D-520: fuera «Saltar» y «Retomar»; «Recogido» sale también cuando la carga aún no está lista, apagado y con el motivo a
// la vista; y «📍 Llegué», que es de la PARADA entera y no de cada orden.
//
// D-527 (2026-10-11), cuatro pedidos del dueño sobre esta fila:
//  - «arrived and pickuped up showuld be in the same row»: «📍 Llegué» va DENTRO de la fila de botones de la primera orden
//    de su tramo (`ordenDeLaLlegada`), al principio: «📍 Llegué · 🚚 Recogido», «📍 Llegué · ✅ Entregado · ⛔ Rechazado».
//    Para que tres quepan a 390 px, cada botón lleva el icono arriba y la palabra debajo (`BOTON_DE_FILA`).
//  - «when i press the pickup … the order should also popo up as in the delivery part»: «Recogido» y «Entregado» llaman a
//    `cerrar(d, accion)`, que en la página abre la ficha (y, al entregar, la cámara). Ya no cierran la parada de un toque.
//  - «the driver can undo an arrive or a pickup»: «✓ Llegaste 10:42 · ↩ Deshacer» en el sitio de «Llegué», y
//    «↩ Deshacer recogido» en la recogida ya hecha, los dos con confirmación.
//  - «override a pickup even if the warheouse doesnt have it ready»: «Recogido» ya no se apaga por no estar lista; la ficha
//    pide la nota (`recogida-del-chofer.ts`).
//
// D-533 (2026-10-12), **reemplaza en parte a D-527**: «make arrived first and then pickup not 2 button just 1 that changes»
// y «for deliver i want arrived that changes into delivered but rejected will always show so 2 buttons for delivery». La
// fila lleva UN botón que cambia: «📍 Llegué» mientras la parada no tiene llegada, y «🚚 Recogido» / «✅ Entregado» al
// llegar (`botonesConLlegada`); «⛔ Rechazado» sigue siempre en la entrega. «✓ Llegaste 10:42 · ↩ Deshacer» baja a un
// renglón pequeño. Y «Recogido» con la carga lista ya NO abre la ficha: la página recoge de un toque (`cerrar`); la orden
// se abre tocando su factura.
// ============================================================

/** Un botón solo en su fila: a lo ancho, como antes («Dejar en tienda» de una rechazada). */
const BOTON: React.CSSProperties = { flex: "1 1 0", minHeight: 44, justifyContent: "center", fontSize: 15, minWidth: 0 };
/** Un botón de la fila de la parada (D-527): el icono arriba y la palabra debajo, para que «Llegué · Entregado ·
 *  Rechazado» quepan en una fila a 390 px sin cortar ninguna palabra. Nunca menos de 44 px de alto. */
const BOTON_DE_FILA: React.CSSProperties = {
  flex: "1 1 0", minHeight: 52, minWidth: 0, flexDirection: "column", justifyContent: "center", gap: 2,
  padding: "6px 4px", fontSize: 14, lineHeight: 1.15, textAlign: "center",
};
const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** El contenido de un botón de la fila: icono arriba, palabra debajo. */
function Rotulo({ icono, texto, extra }: { icono: string; texto: string; extra?: React.CSSProperties }) {
  return (
    <>
      <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 1 }}>{icono}</span>
      <span style={extra}>{texto}</span>
    </>
  );
}

/**
 * «📍 Llegué / Arrived» de una parada (D-520), como el primer botón de la fila de su primera orden (D-527). Qué hay que
 * marcar lo decide `llegadaDeLaParada`: `null`, nada; `pendiente`, el botón, que deja un evento de llegada en cada orden de
 * la parada que esté en ese tramo; `hecha`, «✓ Llegaste 10:42» con «↩ Deshacer» debajo, que pregunta y deja el evento de
 * vuelta en cada orden que tenía la llegada.
 */
export function BotonDeLlegada({ llegada, soloLectura = false }: { llegada: LlegadaDeParada | null; soloLectura?: boolean }) {
  const { marcarParada, notify } = useData();
  const { t } = usePrefs();
  const confirmar = useConfirm();
  const [ocupado, setOcupado] = useState(false);
  if (!llegada) return null;
  if (llegada.estado === "hecha") {
    const deshacer = async () => {
      if (ocupado || soloLectura) return;
      const si = await confirmar(
        t(`Undo your ${hora(llegada.at)} arrival? You can mark it again when you get there.`,
          `¿Deshacer tu llegada de las ${hora(llegada.at)}? La puedes marcar otra vez al llegar.`),
        { confirmLabel: t("Undo arrival", "Deshacer llegada") },
      );
      if (!si) return;
      setOcupado(true);
      let todas = true;
      for (const id of llegada.conLlegada) todas = (await marcarParada(id, kindDeDeshacerLlegada(llegada.tipo), null)) && todas;
      setOcupado(false);
      if (todas) notify(t("Arrival undone", "Llegada deshecha"));
    };
    // D-533: ya no es un botón de la fila —el único botón grande de la fila es el que cambia, «Llegué» → «Recogido»—; es un
    // renglón pequeño debajo de los botones, con el «↩ Deshacer» de D-527 dentro.
    return (
      <span data-llegada="hecha" className="hint" style={{ display: "block", marginTop: 4, fontSize: 13 }}>
        <span style={{ color: "var(--green)", fontWeight: 800 }}>✓ {t("Arrived", soloLectura ? "Llegó" : "Llegaste")} {hora(llegada.at)}</span>
        {" · "}
        {/* Al mirar la ruta de otro (D-502) se ve igual, apagado. */}
        <button type="button" data-accion="deshacer_llegada" disabled={soloLectura || ocupado} onClick={() => void deshacer()}
          style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "var(--accent)", cursor: "pointer", textDecoration: "underline" }}
          title={t("Undo the arrival", "Deshacer la llegada")}>
          {ocupado ? t("Saving…", "Guardando…") : `↩ ${t("Undo", "Deshacer")}`}
        </button>
      </span>
    );
  }
  const llegar = async () => {
    if (ocupado || soloLectura) return;
    setOcupado(true);
    let todas = true;
    for (const id of llegada.ordenes) todas = (await marcarParada(id, kindDeLlegada(llegada.tipo), null)) && todas;
    setOcupado(false);
    if (todas) notify(llegada.tipo === "P" ? t("Arrived at the store", "Llegaste a la tienda") : t("Arrived at the customer", "Llegaste con el cliente"));
  };
  return (
    <button data-accion="llegue" data-llegada="pendiente" className="btn btn-primary" style={BOTON_DE_FILA} disabled={soloLectura || ocupado} onClick={() => void llegar()}>
      <Rotulo icono="📍" texto={ocupado ? t("Saving…", "Guardando…") : t("Arrived", "Llegué")} />
    </button>
  );
}

export function AccionesDeParada({
  pedido, tipo, marca, cerrar, llegada = null, deshacer = null, soloLectura = false, guardando = false,
}: {
  pedido: Delivery;
  tipo: "P" | "D";
  marca: MarcaDeParada | null | undefined;
  /** «Recogido» o «Entregado»: la página recoge de un toque (D-533, con la carga lista) o abre la ficha en ese paso (y
   *  la cámara, al entregar). */
  cerrar: (d: Delivery, accion: "recoger" | "entregar") => void;
  /** «📍 Llegué» de la parada, si esta orden está en su tramo (D-533: en la fila de CADA orden de la parada; con la
   *  llegada pendiente es el único botón grande, y «Recogido»/«Entregado» salen al llegar: `botonesConLlegada`). */
  llegada?: LlegadaDeParada | null;
  /** La página está escribiendo la recogida de un toque de esta orden (D-533): el botón, apagado y «Guardando…». */
  guardando?: boolean;
  /** «↩ Deshacer recogido» (D-527): `deshacerRecogida` lo calcula con el historial; `null`, no se ofrece. */
  deshacer?: DeshacerRecogida;
  /**
   * La ruta de OTRO chofer, mirada desde la pestaña «Chofer» del admin (D-502): los mismos botones, todos apagados. Se
   * pintan igual para que el admin vea lo que ve el chofer; no se pulsan porque escribirían en nombre de quien mira.
   */
  soloLectura?: boolean;
}) {
  const { me, users, settings, marcarParada, pushNotifs, notify, setStage } = useData();
  const { t, lang } = usePrefs();
  const confirmar = useConfirm();
  const [ocupado, setOcupado] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const es = lang === "es";
  const apagado = soloLectura || ocupado || guardando;

  // D-533: con la llegada de la parada pendiente, «Recogido»/«Entregado» no se pintan; la fila lleva «📍 Llegué».
  const acciones = botonesConLlegada(accionesDeParada(tipo, pedido.stage, marca, deshacer), llegada);
  // El motivo de lo apagado, a la vista: en un teléfono no hay `title` que leer.
  const motivos = [...new Set(acciones.flatMap((b) => (b.apagado ? [t(b.apagado.en, b.apagado.es)] : [])))];
  const etiqueta = pedido.invoice_num || `#${orderLabel(pedido)}`;

  const marcar = async (kind: string, note: string | null, aviso: string) => {
    if (ocupado || soloLectura) return false;
    setOcupado(true);
    const ok = await marcarParada(pedido.id, kind, note);
    setOcupado(false);
    if (ok) notify(aviso);
    return ok;
  };

  /** «↩ Deshacer recogido» (D-527): pregunta, y vuelve a `ready` borrando los sellos de la recogida. */
  const deshacerRecogido = async () => {
    if (ocupado || soloLectura) return;
    const si = await confirmar(
      t(`Undo the pickup of ${etiqueta}? It goes back to ready at the store, as if you hadn't loaded it.`,
        `¿Deshacer «Recogido» de ${etiqueta}? Vuelve a «lista» en la tienda, como si no la hubieras cargado.`),
      { confirmLabel: t("Undo pickup", "Deshacer recogido"), danger: true },
    );
    if (!si) return;
    setOcupado(true);
    const { patch, note } = escrituraDeshacerRecogida(t);
    const hecho = await setStage(pedido.id, "ready", note, patch);
    setOcupado(false);
    if (hecho) notify(t("Pickup undone — back to ready", "Recogida deshecha — vuelve a lista"));
  };

  return (
    <>
      {marca && (
        <span data-marca-de-parada={marca.marca} className="hint" style={{ display: "block", marginTop: 4, color: "var(--red)", fontWeight: 700 }}>
          ⛔ {t("Rejected by customer", "Rechazada por el cliente")}: {razonDeLaNota(marca.motivo)}
        </span>
      )}
      {(acciones.length > 0 || llegada?.estado === "pendiente") && (
        <div data-acciones-de-parada style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {llegada?.estado === "pendiente" && <BotonDeLlegada llegada={llegada} soloLectura={soloLectura} />}
          {acciones.map(({ accion: a, apagado: porQue }) => {
            if (a === "dejar") return me ? <LeaveAtStore key={a} pedido={pedido} me={me} disabled={soloLectura} style={BOTON} /> : null;
            if (a === "recoger" || a === "entregar") return (
              <button key={a} data-accion={a} data-apagado={porQue ? "" : undefined} className="btn btn-green" style={BOTON_DE_FILA}
                disabled={apagado || !!porQue} title={porQue ? t(porQue.en, porQue.es) : undefined} onClick={() => cerrar(pedido, a)}>
                {a === "recoger"
                  ? <Rotulo icono="🚚" texto={guardando ? t("Saving…", "Guardando…") : t("Picked up", "Recogido")} />
                  : <Rotulo icono="✅" texto={t("Delivered", "Entregado")} />}
              </button>
            );
            if (a === "deshacer_recogida") return (
              <button key={a} data-accion={a} data-apagado={porQue ? "" : undefined} className="btn btn-ghost" style={BOTON_DE_FILA}
                disabled={apagado || !!porQue} title={porQue ? t(porQue.en, porQue.es) : undefined} onClick={() => void deshacerRecogido()}>
                <Rotulo icono="↩" texto={ocupado ? t("Saving…", "Guardando…") : t("Undo pickup", "Deshacer recogido")} />
              </button>
            );
            return (
              <button key={a} data-accion={a} className="btn btn-danger" style={BOTON_DE_FILA} disabled={apagado} onClick={() => setRechazando(true)}>
                <Rotulo icono="⛔" texto={t("Rejected", "Rechazado")} />
              </button>
            );
          })}
        </div>
      )}
      {/* D-533: «✓ Llegaste 10:42 · ↩ Deshacer», en un renglón debajo de los botones. */}
      {llegada?.estado === "hecha" && <BotonDeLlegada llegada={llegada} soloLectura={soloLectura} />}
      {motivos.map((m) => (
        <span key={m} data-motivo-apagado className="hint" style={{ display: "block", marginTop: 4 }}>⏳ {m}</span>
      ))}
      {rechazando && (
        <DialogoDeRechazo
          titulo={`${t("Rejected", "Rechazado")} · ${pedido.invoice_num || `#${orderLabel(pedido)}`}`}
          es={es}
          t={t}
          ocupado={ocupado}
          origen={pedido.store}
          tiendas={settings.stores.map((s) => s.name)}
          onCancelar={() => setRechazando(false)}
          onConfirmar={async (razon, destino) => {
            const tienda = tiendaDelRechazo(destino, pedido.store, settings.stores);
            if (!tienda) return;
            const nota = `${notaDeRechazo(razon, lang)} · ${notaDelDestino(destino, tienda.name, lang)}`;
            const ok = await marcar(KIND_RECHAZADA, nota, t("Rejection recorded — logistics was notified", "Rechazo guardado — se avisó a logística"));
            if (!ok) return;
            setRechazando(false);
            // Y el material, a la tienda elegida (D-495): el mismo «Dejar en tienda» de D-224. Si esto fallara, el rechazo ya
            // quedó y la parada sigue ofreciendo «Dejar en tienda».
            const { patch, note } = escrituraDejarEnTienda({ pedido, tienda, me, t });
            const dejado = await setStage(pedido.id, "ready", note, patch, EVENTO_DEJADO);
            if (dejado) notify(t(`Left at ${tienda.name} — back on the board`, `Dejado en ${tienda.name} — vuelve a la lista`));
            void pushNotifs(avisosDeRechazo({
              users, actorId: me?.id, delivery_id: pedido.id, order_no: pedido.order_no ?? null,
              etiqueta: `#${orderLabel(pedido)}`, razon, chofer: me?.full_name,
            }));
          }}
        />
      )}
    </>
  );
}

/**
 * Rechazado obliga a dar razón —un motivo de un toque (o «Otro» + texto)— y a decir qué se hace con el material: regresarlo a
 * su tienda de origen o dejarlo en otra (D-495). Confirmar queda apagado hasta tener las dos.
 */
function DialogoDeRechazo({ titulo, es, t, ocupado, origen, tiendas, onCancelar, onConfirmar }: {
  titulo: string;
  es: boolean;
  t: (en: string, es: string) => string;
  ocupado: boolean;
  /** La tienda de donde salió el pedido (`store`). */
  origen: string | null | undefined;
  tiendas: readonly string[];
  onCancelar: () => void;
  onConfirmar: (razon: string, destino: DestinoDelRechazo) => void;
}) {
  const [clave, setClave] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [destino, setDestino] = useState<DestinoDelRechazo | null>(null);
  const razon = razonDeRechazo(clave, texto, es ? "es" : "en");
  const pideTexto = clave === "other" || clave === null;
  const origenValido = !!origen && tiendas.some((n) => n.trim().toLowerCase() === origen.trim().toLowerCase());
  const destinoListo = !!tiendaDelRechazo(destino, origen, tiendas.map((name) => ({ name })));
  return (
    <div className="overlay" data-dialogo-rechazo onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>⛔ {titulo}</h3>
        <div className="hint" style={{ marginBottom: 8 }}>{t("Why did the customer reject it? A reason is required.", "¿Por qué la rechazó el cliente? La razón es obligatoria.")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {MOTIVOS_DE_RECHAZO.map((m) => (
            <button key={m.clave} data-motivo={m.clave} className={`btn btn-sm${clave === m.clave ? " btn-primary" : ""}`} style={{ minHeight: 40 }}
              aria-pressed={clave === m.clave} onClick={() => setClave(clave === m.clave ? null : m.clave)}>
              {es ? m.es : m.en}
            </button>
          ))}
        </div>
        <div className="field">
          <label>{pideTexto ? t("Reason (required)", "Razón (obligatoria)") : t("Details (optional)", "Detalle (opcional)")}</label>
          <textarea data-razon value={texto} rows={3} onChange={(e) => setTexto(e.target.value)}
            placeholder={t("What happened at the door?", "¿Qué pasó en la puerta?")} style={{ width: "100%" }} />
        </div>
        <div data-destino-rechazo style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("What will you do with the material?", "¿Qué vas a hacer con el material?")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {origenValido && (
              <button data-destino="origen" className={`btn${destino?.tipo === "origen" ? " btn-primary" : ""}`} style={{ minHeight: 44, justifyContent: "flex-start" }}
                aria-pressed={destino?.tipo === "origen"} onClick={() => setDestino({ tipo: "origen" })}>
                ↩ {t(`Take it back to ${origen}`, `Regresarlo a ${origen}`)}
              </button>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14 }}>
              🏬 {t("Leave it at a store:", "Dejarlo en una tienda:")}
              <select data-destino="tienda" value={destino?.tipo === "tienda" ? destino.nombre : ""}
                onChange={(e) => setDestino(e.target.value ? { tipo: "tienda", nombre: e.target.value } : null)} style={{ minHeight: 40 }}>
                <option value="">{t("Which store?", "¿En qué tienda?")}</option>
                {tiendas.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
          <button data-confirmar-rechazo className="btn btn-danger" style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
            disabled={!razon || !destinoListo || ocupado} onClick={() => { if (razon && destino && destinoListo) onConfirmar(razon, destino); }}>
            {ocupado ? t("Saving…", "Guardando…") : t("Confirm rejected", "Confirmar rechazo")}
          </button>
        </div>
      </div>
    </div>
  );
}
