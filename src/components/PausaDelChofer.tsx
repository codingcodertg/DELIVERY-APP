"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { captureLocationSplit } from "@/lib/geo";
import { todayISO } from "@/lib/utils";
import { PhotoUpload } from "@/components/PhotoUpload";
import { usePausasDelChofer, type ResultadoDePausa } from "@/lib/usePausasDelChofer";
import {
  MOTIVOS_DE_PAUSA, cierreDePausa, inicioDePausa, pausaAbierta, pideRecibo, textoDePausaAbierta,
  type MotivoDePausa, type PausaDelChofer as Pausa,
} from "@/lib/pausas-del-chofer";

// ============================================================
// «⏸ Registrar parada» en «Mi ruta» (D-520): el botón, el cuadro con el motivo, y —mientras está parado— «⏸ En parada:
// ⛽ Gasolina · 10:42» con «▶ Seguir». Qué se guarda y cuándo se puede seguir lo decide `lib/pausas-del-chofer.ts`; aquí se
// pinta y se escribe.
//
// El recibo de la gasolina se pide al pulsar «▶ Seguir», no al registrar la parada: el recibo sale de la bomba al terminar
// de cargar, y pedirlo antes obligaría a volver a abrir la parada para añadirlo.
//
// D-523: la cámara del recibo también sale al elegir «⛽ Gasolina» al registrar la parada, OPCIONAL —quien paga antes
// dentro ya tiene el recibo—, y si ya la tomó, «▶ Seguir» la trae puesta y no la vuelve a pedir. En los dos sitios hay
// «📷 Cámara» y «🖼 Galería». El dueño, 2026-10-11: «gas stop add the option for the camera of the receipt».
// ============================================================

const BOTON: React.CSSProperties = { flex: "1 1 0", minHeight: 44, justifyContent: "center", fontSize: 15, minWidth: 0 };
const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function PausaDelChofer({ driverId, soloLectura = false }: {
  /** De quién son las paradas: el chofer en su teléfono, o el elegido en la pestaña «Chofer» del admin (D-502). */
  driverId: string | null | undefined;
  /** La ruta de OTRO chofer (D-502): se ve si está parado, pero nada se pulsa en su nombre. */
  soloLectura?: boolean;
}) {
  const { teaching, notify } = useData();
  const { t, lang } = usePrefs();
  const es = lang === "es";
  const { pausas, empezar, seguir, ubicarTarde } = usePausasDelChofer(driverId, todayISO(), { practica: teaching });
  const abierta = pausaAbierta(pausas);
  const [registrando, setRegistrando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Lo que se le dice al chofer si no se pudo guardar: la tabla sin crear (la 167 sin aplicar) o cualquier otro fallo. */
  const avisoDeFallo = (r: Extract<ResultadoDePausa, { ok: false }>) => r.sinTabla
    ? t("Couldn't save it: stops can't be logged yet (the database is missing an update). Tell logistics.", "No se pudo guardar: aún no se pueden registrar paradas (a la base le falta una actualización). Avísale a logística.")
    : t(`Couldn't save it: ${r.mensaje}`, `No se pudo guardar: ${r.mensaje}`);

  const alEmpezar = async (motivo: MotivoDePausa, nota: string | null, foto: string | null) => {
    if (soloLectura || ocupado) return;
    setOcupado(true);
    setError(null);
    // La ubicación como en «Recogido» (D-218): se espera poco y, si no llega, se guarda igual y se añade después.
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    const r = await empezar({ motivo, nota, recibo_foto: pideRecibo(motivo) ? foto : null }, gps);
    setOcupado(false);
    if (!r.ok) { setError(avisoDeFallo(r)); notify(avisoDeFallo(r)); return; }
    setRegistrando(false);
    notify(textoDePausaAbierta(r.pausa, lang, hora));
    if (!gps) void eventual.then((tarde) => { if (tarde) void ubicarTarde(r.pausa.id, tarde); });
  };

  const alSeguir = async (p: Pausa, entrada: { foto: string | null; monto: string; galones: string; sinRecibo: boolean }) => {
    if (soloLectura || ocupado) return;
    const cierre = cierreDePausa(p.motivo, entrada);
    if ("falta" in cierre) return;
    setOcupado(true);
    setError(null);
    const r = await seguir(p, cierre);
    setOcupado(false);
    if (!r.ok) { setError(avisoDeFallo(r)); notify(avisoDeFallo(r)); return; }
    setCerrando(false);
    notify(t("Back on the route", "De vuelta a la ruta"));
  };

  return (
    <div data-pausa-del-chofer style={{ marginBottom: 8 }}>
      {abierta ? (
        <div className="banner warn" role="status" data-pausa-abierta={abierta.motivo} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 180px", minWidth: 0 }}>
            <b>{textoDePausaAbierta(abierta, lang, hora)}</b>
            {abierta.nota && <span className="hint" style={{ display: "block" }}>{abierta.nota}</span>}
          </span>
          <button className="btn btn-green" data-seguir style={{ ...BOTON, flex: "0 0 auto", padding: "0 18px" }} disabled={soloLectura || ocupado}
            onClick={() => (pideRecibo(abierta.motivo) ? setCerrando(true) : void alSeguir(abierta, { foto: null, monto: "", galones: "", sinRecibo: false }))}>
            ▶ {t("Continue", "Seguir")}
          </button>
        </div>
      ) : (
        <button className="btn btn-ghost" data-registrar-parada style={{ width: "100%", minHeight: 44, justifyContent: "center" }} disabled={soloLectura}
          onClick={() => { setError(null); setRegistrando(true); }}>
          ⏸ {t("Log a stop", "Registrar parada")}
        </button>
      )}
      {error && !registrando && !cerrando && <div className="hint" data-error-de-pausa style={{ color: "var(--red)", marginTop: 4 }}>{error}</div>}
      {registrando && (
        <DialogoDeParada es={es} t={t} ocupado={ocupado} error={error}
          onCancelar={() => setRegistrando(false)} onConfirmar={(m, n, f) => void alEmpezar(m, n, f)} />
      )}
      {cerrando && abierta && (
        <DialogoDeRecibo t={t} ocupado={ocupado} error={error} fotoYaTomada={abierta.recibo_foto}
          onCancelar={() => setCerrando(false)} onConfirmar={(entrada) => void alSeguir(abierta, entrada)} />
      )}
    </div>
  );
}

/** El motivo de un toque y una nota; «Otro» obliga a escribir qué. Confirmar queda apagado hasta entonces (`inicioDePausa`). */
function DialogoDeParada({ es, t, ocupado, error, onCancelar, onConfirmar }: {
  es: boolean; t: (en: string, es: string) => string; ocupado: boolean; error: string | null;
  onCancelar: () => void; onConfirmar: (motivo: MotivoDePausa, nota: string | null, foto: string | null) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoDePausa | null>(null);
  const [texto, setTexto] = useState("");
  const [fotos, setFotos] = useState<string[]>([]);
  const inicio = inicioDePausa(motivo, texto);
  const titulo = `⏸ ${t("Log a stop", "Registrar parada")}`;
  return (
    <div className="overlay" data-dialogo-parada onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>{titulo}</h3>
        <div className="hint" style={{ marginBottom: 8 }}>{t("Why are you stopping?", "¿Por qué te detienes?")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {MOTIVOS_DE_PAUSA.map((m) => (
            <button key={m.clave} data-motivo-pausa={m.clave} className={`btn btn-sm${motivo === m.clave ? " btn-primary" : ""}`} style={{ minHeight: 44 }}
              aria-pressed={motivo === m.clave} onClick={() => setMotivo(motivo === m.clave ? null : m.clave)}>
              {m.icono} {es ? m.es : m.en}
            </button>
          ))}
        </div>
        <div className="field">
          <label>{motivo === "other" ? t("What is it? (required)", "¿Qué es? (obligatorio)") : t("Note (optional)", "Nota (opcional)")}</label>
          <textarea data-nota-pausa value={texto} rows={2} onChange={(e) => setTexto(e.target.value)} style={{ width: "100%" }} />
        </div>
        {motivo && pideRecibo(motivo) && (
          <div data-foto-recibo-al-empezar style={{ marginTop: 8 }}>
            <div className="hint" style={{ marginBottom: 4 }}>
              🧾 {t("Receipt photo — now if you have it, or when you press ▶ Continue.", "Foto del recibo — ahora si ya lo tienes, o al pulsar ▶ Seguir.")}
            </div>
            <PhotoUpload photos={fotos} onChange={(n) => setFotos(n.slice(0, 1))} max={1} t={t} disabled={ocupado} galeria />
          </div>
        )}
        {error && <div className="hint" data-error-de-pausa style={{ color: "var(--red)", marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={BOTON} onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
          <button data-confirmar-parada className="btn btn-primary" style={BOTON} disabled={!inicio || ocupado}
            onClick={() => { if (inicio) onConfirmar(inicio.motivo, inicio.nota, fotos[0] ?? null); }}>
            {ocupado ? t("Saving…", "Guardando…") : `⏸ ${t("Start stop", "Empezar parada")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Al seguir tras cargar gasolina: la foto del recibo (la cámara del teléfono, o un archivo), y si quiere, el monto y los
 * galones. Sin foto solo se sigue marcando «No tengo recibo», que queda anotado.
 */
export function DialogoDeRecibo({ t, ocupado, error, fotoYaTomada, onCancelar, onConfirmar }: {
  t: (en: string, es: string) => string; ocupado: boolean; error: string | null;
  /** La que tomó al registrar la parada (D-523): sale puesta y no se vuelve a pedir; puede cambiarla. */
  fotoYaTomada: string | null;
  onCancelar: () => void; onConfirmar: (entrada: { foto: string | null; monto: string; galones: string; sinRecibo: boolean }) => void;
}) {
  const [fotos, setFotos] = useState<string[]>(fotoYaTomada ? [fotoYaTomada] : []);
  const [monto, setMonto] = useState("");
  const [galones, setGalones] = useState("");
  const [sinRecibo, setSinRecibo] = useState(false);
  const entrada = { foto: fotos[0] ?? null, monto, galones, sinRecibo };
  const cierre = cierreDePausa("gas", entrada);
  const falta = "falta" in cierre ? cierre.falta : null;
  const titulo = `⛽ ${t("Gas receipt", "Recibo de gasolina")}`;
  return (
    <div className="overlay" data-dialogo-recibo onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>{titulo}</h3>
        <div className="hint" style={{ marginBottom: 8 }}>{t("Take a photo of the receipt before you continue.", "Toma una foto del recibo antes de seguir.")}</div>
        <div data-foto-recibo>
          <PhotoUpload photos={fotos} onChange={(n) => { setFotos(n.slice(0, 1)); if (n.length) setSinRecibo(false); }} max={1} t={t} disabled={ocupado} galeria />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label>{t("Amount $ (optional)", "Monto $ (opcional)")}</label>
            <input data-monto inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label>{t("Gallons (optional)", "Galones (opcional)")}</label>
            <input data-galones inputMode="decimal" value={galones} onChange={(e) => setGalones(e.target.value)} style={{ width: "100%" }} />
          </div>
        </div>
        {(falta === "monto" || falta === "galones") && (
          <div className="hint" style={{ color: "var(--red)" }}>{falta === "monto" ? t("The amount must be a number.", "El monto tiene que ser un número.") : t("Gallons must be a number.", "Los galones tienen que ser un número.")}</div>
        )}
        {fotos.length === 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            <input type="checkbox" data-sin-recibo checked={sinRecibo} onChange={(e) => setSinRecibo(e.target.checked)} style={{ width: 20, height: 20 }} />
            {t("I don't have a receipt", "No tengo recibo")}
          </label>
        )}
        {error && <div className="hint" data-error-de-pausa style={{ color: "var(--red)", marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={BOTON} onClick={onCancelar}>{t("Back", "Atrás")}</button>
          <button data-confirmar-recibo className="btn btn-green" style={BOTON} disabled={!!falta || ocupado} onClick={() => onConfirmar(entrada)}>
            {ocupado ? t("Saving…", "Guardando…") : `▶ ${t("Continue", "Seguir")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
