"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { accionParada } from "@/lib/one-tap-stop";
import {
  KIND_RECHAZADA, MOTIVOS_DE_RECHAZO, accionesDeParada, avisosDeRechazo, kindDeLlegada, notaDeRechazo,
  notaDelDestino, razonDeLaNota, razonDeRechazo, tiendaDelRechazo, type AccionDeParada, type DestinoDelRechazo,
  type LlegadaDeParada, type MarcaDeParada,
} from "@/lib/acciones-parada";
import { EVENTO_DEJADO, escrituraDejarEnTienda } from "@/lib/leave-at-store";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// Los botones de UNA orden de una parada en «Mi ruta» (D-487; D-520): qué sale lo decide `accionesDeParada`; aquí solo
// se pinta y se escribe. «Recogido» y «Entregado» llaman a `cerrar`, que es el mismo `cerrarParada` de la tarjeta de
// «Siguiente parada» (D-218): una sola vía para la etapa. Rechazado deja un evento y no toca la etapa.
//
// D-520: fuera «Saltar» y «Retomar»; «Recogido» sale también cuando la carga aún no está lista, apagado y con el motivo a
// la vista; y «📍 Llegué», que es de la PARADA entera y no de cada orden, va en `BotonDeLlegada`.
// ============================================================

const BOTON: React.CSSProperties = { flex: "1 1 0", minHeight: 44, justifyContent: "center", fontSize: 15, minWidth: 0 };
const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * «📍 Llegué / Arrived» de una parada (D-520). Qué hay que marcar lo decide `llegadaDeLaParada`: `null`, nada (todo
 * hecho, o nada cargado para entregar); `hecha`, «✓ Llegaste 10:42», que no se repite; `pendiente`, el botón, que deja un
 * evento de llegada en cada orden de la parada que esté en ese tramo.
 */
export function BotonDeLlegada({ llegada, soloLectura = false }: { llegada: LlegadaDeParada | null; soloLectura?: boolean }) {
  const { marcarParada, notify } = useData();
  const { t } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  if (!llegada) return null;
  if (llegada.estado === "hecha") {
    return (
      <span data-llegada="hecha" className="hint" style={{ display: "block", marginTop: 6, color: "var(--green)", fontWeight: 700 }}>
        ✓ {t("Arrived", soloLectura ? "Llegó" : "Llegaste")} {hora(llegada.at)}
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
    <div style={{ display: "flex", marginTop: 8 }}>
      <button data-accion="llegue" data-llegada="pendiente" className="btn btn-primary" style={BOTON} disabled={soloLectura || ocupado} onClick={() => void llegar()}>
        {ocupado ? t("Saving…", "Guardando…") : `📍 ${t("Arrived", "Llegué")}`}
      </button>
    </div>
  );
}

export function AccionesDeParada({
  pedido, tipo, marca, guardando, cerrar, sinPrincipal = false, soloLectura = false,
}: {
  pedido: Delivery;
  tipo: "P" | "D";
  marca: MarcaDeParada | null | undefined;
  /** Esta parada se está guardando (recoger/entregar): sus botones se apagan. */
  guardando: boolean;
  /** Recoger o entregar: el `cerrarParada` de la página. */
  cerrar: (d: Delivery) => void;
  /** En la tarjeta de «Siguiente parada» el botón verde ya existe: aquí solo van los demás. */
  sinPrincipal?: boolean;
  /**
   * La ruta de OTRO chofer, mirada desde la pestaña «Chofer» del admin (D-502): los mismos botones, todos apagados. Se
   * pintan igual para que el admin vea lo que ve el chofer; no se pulsan porque escribirían en nombre de quien mira.
   */
  soloLectura?: boolean;
}) {
  const { me, users, settings, marcarParada, pushNotifs, notify, setStage } = useData();
  const { t, lang } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const es = lang === "es";
  const apagado = soloLectura || guardando || ocupado;

  const todas = accionesDeParada(tipo, pedido.stage, marca);
  const acciones = sinPrincipal ? todas.filter((b) => b.accion !== "recoger" && b.accion !== "entregar" && b.accion !== "dejar") : todas;
  // El motivo de lo apagado, a la vista: en un teléfono no hay `title` que leer.
  const motivos = [...new Set(acciones.flatMap((b) => (b.apagado ? [t(b.apagado.en, b.apagado.es)] : [])))];

  const marcar = async (kind: string, note: string | null, aviso: string) => {
    if (ocupado || soloLectura) return false;
    setOcupado(true);
    const ok = await marcarParada(pedido.id, kind, note);
    setOcupado(false);
    if (ok) notify(aviso);
    return ok;
  };

  const etiquetaPrincipal = (a: AccionDeParada) => {
    if (a === "recoger") return `🚚 ${t("Picked up", "Recogido")}`;
    // Si falta firma o foto, el botón abre la ficha (la misma regla que la tarjeta de arriba, D-218).
    return accionParada(pedido.stage, settings, pedido.photos).kind === "pod"
      ? `✅ ${t("Delivered…", "Entregado…")}`
      : `✅ ${t("Delivered", "Entregado")}`;
  };

  return (
    <>
      {marca && (
        <span data-marca-de-parada={marca.marca} className="hint" style={{ display: "block", marginTop: 4, color: "var(--red)", fontWeight: 700 }}>
          ⛔ {t("Rejected by customer", "Rechazada por el cliente")}: {razonDeLaNota(marca.motivo)}
        </span>
      )}
      {acciones.length > 0 && (
        <div data-acciones-de-parada style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {acciones.map(({ accion: a, apagado: porQue }) => {
            if (a === "dejar") return me ? <LeaveAtStore key={a} pedido={pedido} me={me} disabled={soloLectura} style={BOTON} /> : null;
            if (a === "recoger" || a === "entregar") return (
              <button key={a} data-accion={a} data-apagado={porQue ? "" : undefined} className="btn btn-green" style={BOTON}
                disabled={apagado || !!porQue} title={porQue ? t(porQue.en, porQue.es) : undefined} onClick={() => cerrar(pedido)}>
                {guardando ? t("Saving…", "Guardando…") : etiquetaPrincipal(a)}
              </button>
            );
            return (
              <button key={a} data-accion={a} className="btn btn-danger" style={BOTON} disabled={apagado} onClick={() => setRechazando(true)}>
                ⛔ {t("Rejected", "Rechazado")}
              </button>
            );
          })}
        </div>
      )}
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
