"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { accionParada } from "@/lib/one-tap-stop";
import {
  KIND_RECHAZADA, KIND_RETOMADA, KIND_SALTADA, MOTIVOS_DE_RECHAZO, accionesDeParada, avisosDeRechazo, notaDeRechazo,
  razonDeLaNota, razonDeRechazo, type AccionDeParada, type MarcaDeParada,
} from "@/lib/acciones-parada";
import { LeaveAtStore } from "@/components/LeaveAtStore";
import { orderLabel } from "@/lib/utils";
import type { Delivery } from "@/lib/types";

// ============================================================
// Los botones de UNA parada en «Mi ruta» (D-487): qué sale lo decide `accionesDeParada`; aquí solo se pinta y se
// escribe. «Recogido» y «Entregado» llaman a `cerrar`, que es el mismo `cerrarParada` de la tarjeta de «Siguiente
// parada» (D-218): una sola vía para la etapa. Saltar, Retomar y Rechazado dejan un evento y no tocan la etapa.
// ============================================================

const BOTON: React.CSSProperties = { flex: "1 1 0", minHeight: 44, justifyContent: "center", fontSize: 15, minWidth: 0 };

export function AccionesDeParada({
  pedido, tipo, marca, guardando, cerrar, sinPrincipal = false,
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
}) {
  const { me, users, settings, marcarParada, pushNotifs, notify } = useData();
  const { t, lang } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const es = lang === "es";

  const todas = accionesDeParada(tipo, pedido.stage, marca);
  const acciones = sinPrincipal ? todas.filter((a) => a !== "recoger" && a !== "entregar" && a !== "dejar") : todas;

  const marcar = async (kind: string, note: string | null, aviso: string) => {
    if (ocupado) return false;
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
        <span data-marca-de-parada={marca.marca} className="hint" style={{ display: "block", marginTop: 4, color: marca.marca === "rechazada" ? "var(--red)" : "var(--amber)", fontWeight: 700 }}>
          {marca.marca === "rechazada"
            ? `⛔ ${t("Rejected by customer", "Rechazada por el cliente")}: ${razonDeLaNota(marca.motivo)}`
            : `⏭ ${t("Skipped — do it later", "Saltada — hazla después")}`}
        </span>
      )}
      {acciones.length > 0 && (
        <div data-acciones-de-parada style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {acciones.map((a) => {
            if (a === "dejar") return me ? <LeaveAtStore key={a} pedido={pedido} me={me} style={BOTON} /> : null;
            if (a === "recoger" || a === "entregar") return (
              <button key={a} data-accion={a} className="btn btn-green" style={BOTON} disabled={guardando || ocupado} onClick={() => cerrar(pedido)}>
                {guardando ? t("Saving…", "Guardando…") : etiquetaPrincipal(a)}
              </button>
            );
            if (a === "saltar") return (
              <button key={a} data-accion={a} className="btn btn-amber" style={BOTON} disabled={guardando || ocupado}
                onClick={() => void marcar(KIND_SALTADA, null, t("Stop skipped", "Parada saltada"))}>
                ⏭ {t("Skip", "Saltar")}
              </button>
            );
            if (a === "retomar") return (
              <button key={a} data-accion={a} className="btn btn-ghost" style={BOTON} disabled={guardando || ocupado}
                onClick={() => void marcar(KIND_RETOMADA, null, t("Stop resumed", "Parada retomada"))}>
                ↩ {t("Resume", "Retomar")}
              </button>
            );
            return (
              <button key={a} data-accion={a} className="btn btn-danger" style={BOTON} disabled={guardando || ocupado} onClick={() => setRechazando(true)}>
                ⛔ {t("Rejected", "Rechazado")}
              </button>
            );
          })}
        </div>
      )}
      {rechazando && (
        <DialogoDeRechazo
          titulo={`${t("Rejected", "Rechazado")} · ${pedido.invoice_num || `#${orderLabel(pedido)}`}`}
          es={es}
          t={t}
          ocupado={ocupado}
          onCancelar={() => setRechazando(false)}
          onConfirmar={async (razon) => {
            const ok = await marcar(KIND_RECHAZADA, notaDeRechazo(razon, lang), t("Rejection recorded — logistics was notified", "Rechazo guardado — se avisó a logística"));
            if (!ok) return;
            setRechazando(false);
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

/** Rechazado obliga a dar razón: un motivo de un toque (o «Otro» + texto). Confirmar queda apagado hasta entonces. */
function DialogoDeRechazo({ titulo, es, t, ocupado, onCancelar, onConfirmar }: {
  titulo: string;
  es: boolean;
  t: (en: string, es: string) => string;
  ocupado: boolean;
  onCancelar: () => void;
  onConfirmar: (razon: string) => void;
}) {
  const [clave, setClave] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const razon = razonDeRechazo(clave, texto, es ? "es" : "en");
  const pideTexto = clave === "other" || clave === null;
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
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={{ flex: 1, minHeight: 44, justifyContent: "center" }} onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
          <button data-confirmar-rechazo className="btn btn-danger" style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
            disabled={!razon || ocupado} onClick={() => { if (razon) onConfirmar(razon); }}>
            {ocupado ? t("Saving…", "Guardando…") : t("Confirm rejected", "Confirmar rechazo")}
          </button>
        </div>
      </div>
    </div>
  );
}
