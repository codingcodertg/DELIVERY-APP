"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { captureLocationSplit } from "@/lib/geo";
import { todayISO } from "@/lib/utils";
import { PhotoUpload } from "@/components/PhotoUpload";
import { mensajeDeError } from "@/lib/mensaje-de-error";
import { usePausasDelChofer, type ResultadoDePausa } from "@/lib/usePausasDelChofer";
import {
  MOTIVOS_PARA_ELEGIR, cierreDePausa, esParadaVieja, esRechazoDeFoto, horaDeCierreDeVieja, inicioDePausa, minutosDePausa,
  nombreDelMotivo, pideRecibo, recibosPendientes, reciboTardio, textoDePausaAbierta,
  type MotivoDePausa, type PausaDelChofer as Pausa,
} from "@/lib/pausas-del-chofer";

// ============================================================
// «⏸ Registrar parada» en «Mi ruta» (D-520) y en «Paradas» (la tercera pestaña del chofer, 2026-11-19): el botón, el cuadro
// con el motivo, y —mientras está parado— «⏸ En parada: ⛽ Gasolina · 10:42» con «✔ Terminar parada». Qué se guarda y
// cuándo se puede seguir lo decide `lib/pausas-del-chofer.ts`; aquí se pinta y se escribe.
//
// Dos piezas: `PausaDelChofer` (la de siempre: crea su propio estado) y `PausaDelChoferVista`, que pinta el MISMO estado que
// le pasen. «Paradas» la usa con el estado que ya tiene para su línea de tiempo, así empezar o terminar una parada se ve en
// las dos a la vez.
//
// El recibo de la gasolina se pide al pulsar «Terminar parada», no al registrar la parada (D-523 deja la foto opcional al
// empezar). Cambio del 2026-11-13: el recibo ya NO es obligatorio para cerrar. Lo que falta sale en «🧾 Recibos pendientes».
// Cambio del 2026-11-19: la foto y el monto valen para CUALQUIER motivo, y se pueden añadir después desde «Paradas».
// ============================================================

const BOTON: React.CSSProperties = { flex: "1 1 0", minHeight: 44, justifyContent: "center", fontSize: 15, minWidth: 0 };
const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fechaYHora = (iso: string) => `${new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })} ${hora(iso)}`;
const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
const VACIO = { foto: null, monto: "", galones: "", sinRecibo: false };

type Store = ReturnType<typeof usePausasDelChofer>;
export type Traductor = (en: string, es: string) => string;

/** El aviso de un fallo al escribir, en palabras de la app. `deFoto`: el fallo viene de subir la foto o el monto. */
export function avisoDeFalloDePausa(r: Extract<ResultadoDePausa, { ok: false }>, t: Traductor, lang: "en" | "es", deFoto = false): string {
  if (r.sinTabla) return t("Couldn't save it: stops can't be logged yet (the database is missing an update). Tell logistics.", "No se pudo guardar: aún no se pueden registrar paradas (a la base le falta una actualización). Avísale a logística.");
  if (r.yaAbierta) return t("You already have a stop open: finish it before logging another.", "Ya tienes una parada abierta: termínala antes de registrar otra.");
  if (deFoto && esRechazoDeFoto(r.error)) return t("The photo couldn't be saved yet: the database needs an update. Nothing else was lost.", "La foto aún no se pudo guardar: a la base le falta una actualización. Lo demás sí quedó guardado.");
  return mensajeDeError(r.error, lang);
}

export function PausaDelChofer({ driverId, soloLectura = false, dia = todayISO() }: {
  /** De quién son las paradas: el chofer en su teléfono, o el elegido en la pestaña «Chofer» del admin (D-502). */
  driverId: string | null | undefined;
  /** La ruta de OTRO chofer (D-502): se ve si está parado, pero nada se pulsa en su nombre. */
  soloLectura?: boolean;
  /** El día que se mira en «Mi ruta» (hoy o ayer). Solo hoy se puede registrar una parada: nunca de atrás. */
  dia?: string;
}) {
  const { teaching } = useData();
  const store = usePausasDelChofer(driverId, dia, { practica: teaching });
  return <PausaDelChoferVista store={store} soloLectura={soloLectura} dia={dia} />;
}

/** Lo que pinta la parada con el estado que le pasen (`usePausasDelChofer`). */
export function PausaDelChoferVista({ store, soloLectura = false, dia = todayISO(), mostrarPendientes = true }: {
  store: Store;
  soloLectura?: boolean;
  dia?: string;
  /** «🧾 Recibos pendientes» debajo. «Paradas» lo pone en su propia línea de tiempo, así que lo apaga ahí. */
  mostrarPendientes?: boolean;
}) {
  const { notify } = useData();
  const { t, lang } = usePrefs();
  const es = lang === "es";
  const { pausas, abierta, empezar, seguir, recibir, ubicarTarde } = store;
  const hoy = dia === todayISO();
  const pendientes = recibosPendientes(pausas);
  const [registrando, setRegistrando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [anadiendo, setAnadiendo] = useState<Pausa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alEmpezar = async (motivo: MotivoDePausa, nota: string | null, foto: string | null) => {
    if (soloLectura || ocupado) return;
    setOcupado(true);
    setError(null);
    // La ubicación como en «Recogido» (D-218): se espera poco y, si no llega, se guarda igual y se añade después.
    const { immediate, eventual } = captureLocationSplit();
    const gps = await immediate;
    const r = await empezar({ motivo, nota, recibo_foto: pideRecibo(motivo) ? foto : null }, gps);
    setOcupado(false);
    if (!r.ok) { const m = avisoDeFalloDePausa(r, t, lang); setError(m); notify(m); return; }
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
    if (!r.ok) { const m = avisoDeFalloDePausa(r, t, lang, true); setError(m); notify(m); return; }
    setCerrando(false);
    notify(r.fotoNoGuardada
      ? t("Stop finished. The photo couldn't be saved yet (the database needs an update), so the stop was closed without it.", "Parada terminada. La foto aún no se pudo guardar (a la base le falta una actualización), así que se cerró sin ella.")
      : t("Stop finished", "Parada terminada"));
  };

  const alAnadirRecibo = async (p: Pausa, entrada: { foto: string | null; monto: string; galones: string }) => {
    if (soloLectura || ocupado) return;
    const recibo = reciboTardio(entrada, p.motivo);
    if ("falta" in recibo) return;
    setOcupado(true);
    setError(null);
    const r = await recibir(p, recibo);
    setOcupado(false);
    if (!r.ok) { const m = avisoDeFalloDePausa(r, t, lang, true); setError(m); notify(m); return; }
    setAnadiendo(null);
    notify(t("Photo saved", "Foto guardada"));
  };

  const vieja = !!abierta && esParadaVieja(abierta);

  return (
    <div data-pausa-del-chofer style={{ marginBottom: 8 }}>
      {abierta ? (
        <div className="banner warn" role="status" data-pausa-abierta={abierta.motivo} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 180px", minWidth: 0 }}>
            <b>{textoDePausaAbierta(abierta, lang, vieja ? fechaYHora : hora)}</b>
            {abierta.nota && <span className="hint" style={{ display: "block" }}>{abierta.nota}</span>}
            {vieja && (
              <span className="hint" data-parada-vieja style={{ display: "block" }}>
                {t(
                  `It's from ${fechaYHora(abierta.empezo_at)}. It will close at ${hora(horaDeCierreDeVieja(abierta.empezo_at))} when you start another stop or press Finish stop.`,
                  `Es de ${fechaYHora(abierta.empezo_at)}. Se cerrará a las ${hora(horaDeCierreDeVieja(abierta.empezo_at))} al empezar otra parada o al pulsar Terminar parada.`,
                )}
              </span>
            )}
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: "0 0 auto" }}>
            <button className="btn btn-green" data-seguir style={{ ...BOTON, flex: "0 0 auto", padding: "0 18px" }} disabled={soloLectura || ocupado}
              onClick={() => (pideRecibo(abierta.motivo) ? setCerrando(true) : void alSeguir(abierta, VACIO))}>
              ✔ {t("Finish stop", "Terminar parada")}
            </button>
            {!pideRecibo(abierta.motivo) && (
              <button className="btn btn-ghost" data-foto-al-terminar style={{ minHeight: 44, flex: "0 0 auto" }} disabled={soloLectura || ocupado}
                onClick={() => { setError(null); setCerrando(true); }}>
                📷 {t("Photo & amount", "Foto y monto")}
              </button>
            )}
          </div>
        </div>
      ) : hoy && (
        <button className="btn btn-ghost" data-registrar-parada style={{ width: "100%", minHeight: 44, justifyContent: "center" }} disabled={soloLectura}
          onClick={() => { setError(null); setRegistrando(true); }}>
          ⏸ {t("Log a stop", "Registrar parada")}
        </button>
      )}
      {error && !registrando && !cerrando && !anadiendo && <div className="hint" data-error-de-pausa style={{ color: "var(--red)", marginTop: 4 }}>{error}</div>}

      {mostrarPendientes && pendientes.length > 0 && (
        <div className="card" data-recibos-pendientes style={{ marginTop: 8 }}>
          <h2>🧾 {t("Receipts to upload", "Recibos pendientes")}<span className="count-tag">{pendientes.length}</span></h2>
          <div className="hint" style={{ marginBottom: 6 }}>
            {t("Stops already logged. Add each receipt when you have it; the stop time doesn't change.", "Paradas ya registradas. Añade cada recibo cuando lo tengas; la hora de la parada no cambia.")}
          </div>
          {pendientes.map((p) => (
            <div key={p.id} data-pendiente={p.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderTop: "1px solid var(--line, #e5e5e5)" }}>
              <span style={{ flex: "1 1 160px", minWidth: 0 }}>
                <b>{nombreDelMotivo(p.motivo, lang)}</b>
                <span className="hint" style={{ display: "block", margin: 0 }}>
                  {p.termino_at
                    ? `${fechaYHora(p.empezo_at)} · ${fmtMin(minutosDePausa(p))}`
                    : t(`${fechaYHora(p.empezo_at)} · still stopped`, `${fechaYHora(p.empezo_at)} · sigue parado`)}
                </span>
              </span>
              <button className="btn btn-primary" data-anadir-recibo style={{ minHeight: 44, flex: "0 0 auto" }} disabled={soloLectura || ocupado}
                onClick={() => { setError(null); setAnadiendo(p); }}>
                📷 {t("Add receipt", "Añadir recibo")}
              </button>
            </div>
          ))}
        </div>
      )}

      {registrando && (
        <DialogoDeParada es={es} t={t} ocupado={ocupado} error={error}
          onCancelar={() => setRegistrando(false)} onConfirmar={(m, n, f) => void alEmpezar(m, n, f)} />
      )}
      {cerrando && abierta && (
        <DialogoDeRecibo t={t} lang={lang} motivo={abierta.motivo} ocupado={ocupado} error={error} fotoYaTomada={abierta.recibo_foto}
          onCancelar={() => setCerrando(false)} onConfirmar={(entrada) => void alSeguir(abierta, entrada)} />
      )}
      {anadiendo && (
        <DialogoDeReciboPendiente p={anadiendo} t={t} lang={lang} ocupado={ocupado} error={error}
          onCancelar={() => setAnadiendo(null)} onConfirmar={(entrada) => void alAnadirRecibo(anadiendo, entrada)} />
      )}
    </div>
  );
}

/** El motivo de un toque y una nota; «Otro» obliga a escribir qué. Confirmar queda apagado hasta entonces (`inicioDePausa`). */
function DialogoDeParada({ es, t, ocupado, error, onCancelar, onConfirmar }: {
  es: boolean; t: Traductor; ocupado: boolean; error: string | null;
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
          {MOTIVOS_PARA_ELEGIR.map((m) => (
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
              🧾 {t("Receipt photo — now if you have it, or later from the list.", "Foto del recibo — ahora si ya lo tienes, o después desde la lista.")}
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
 * Al terminar una parada: la foto (la cámara del teléfono, o un archivo), y si quiere, el monto. En la gasolina, además los
 * galones y «No tengo recibo». Nada es obligatorio: sin foto la parada se cierra igual (2026-11-13 y 2026-11-19).
 */
export function DialogoDeRecibo({ t, lang, motivo, ocupado, error, fotoYaTomada, onCancelar, onConfirmar }: {
  t: Traductor; lang: "en" | "es"; motivo: MotivoDePausa; ocupado: boolean; error: string | null;
  /** La que tomó al registrar la parada (D-523): sale puesta y no se vuelve a pedir; puede cambiarla. */
  fotoYaTomada: string | null;
  onCancelar: () => void; onConfirmar: (entrada: { foto: string | null; monto: string; galones: string; sinRecibo: boolean }) => void;
}) {
  const gas = pideRecibo(motivo);
  const [fotos, setFotos] = useState<string[]>(fotoYaTomada ? [fotoYaTomada] : []);
  const [monto, setMonto] = useState("");
  const [galones, setGalones] = useState("");
  const [sinRecibo, setSinRecibo] = useState(false);
  const entrada = { foto: fotos[0] ?? null, monto, galones, sinRecibo };
  const cierre = cierreDePausa(motivo, entrada);
  const falta = "falta" in cierre ? cierre.falta : null;
  const titulo = gas ? `⛽ ${t("Gas receipt", "Recibo de gasolina")}` : `📷 ${t("Photo & amount", "Foto y monto")}`;
  const despues = gas && !fotos[0] && !sinRecibo;
  return (
    <div className="overlay" data-dialogo-recibo onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>{titulo}</h3>
        <div className="hint" style={{ marginBottom: 8 }}>
          {gas
            ? t("Take a photo of the receipt before you continue.", "Toma una foto del recibo antes de seguir.")
            : t("Optional. A photo of the receipt or of what you were charged for, and the amount paid.", "Opcional. Una foto del recibo o de lo que te cobraron, y el monto que pagaste.")}
        </div>
        {!gas && <div className="hint" style={{ marginBottom: 4 }}>{t("Add photo (optional)", "Añadir foto (opcional)")}</div>}
        <div data-foto-recibo>
          <PhotoUpload photos={fotos} onChange={(n) => { setFotos(n.slice(0, 1)); if (n.length) setSinRecibo(false); }} max={1} t={t} disabled={ocupado} galeria />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label>{t("Amount $ (optional)", "Monto $ (opcional)")}</label>
            <input data-monto inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ width: "100%" }} />
          </div>
          {gas && (
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>{t("Gallons (optional)", "Galones (opcional)")}</label>
              <input data-galones inputMode="decimal" value={galones} onChange={(e) => setGalones(e.target.value)} style={{ width: "100%" }} />
            </div>
          )}
        </div>
        {(falta === "monto" || falta === "galones") && (
          <div className="hint" style={{ color: "var(--red)" }}>{falta === "monto" ? t("The amount must be a number.", "El monto tiene que ser un número.") : t("Gallons must be a number.", "Los galones tienen que ser un número.")}</div>
        )}
        {gas && fotos.length === 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 14, textTransform: "none", letterSpacing: 0 }}>
            <input type="checkbox" data-sin-recibo checked={sinRecibo} onChange={(e) => setSinRecibo(e.target.checked)} style={{ width: 20, height: 20 }} />
            {t("I don't have a receipt", "No tengo recibo")}
          </label>
        )}
        {despues && (
          <div className="hint" data-recibo-despues style={{ marginTop: 8 }}>
            {t("No receipt yet? Continue anyway: it stays in «Receipts to upload» until you add it.", "¿Aún no tienes el recibo? Sigue igual: queda en «Recibos pendientes» hasta que lo añadas.")}
          </div>
        )}
        {error && <div className="hint" data-error-de-pausa style={{ color: "var(--red)", marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={BOTON} onClick={onCancelar}>{t("Back", "Atrás")}</button>
          <button data-confirmar-recibo className="btn btn-green" style={BOTON} disabled={!!falta || ocupado} onClick={() => onConfirmar(entrada)}>
            {ocupado ? t("Saving…", "Guardando…") : `✔ ${despues ? t("Finish (receipt later)", "Terminar (recibo después)") : t("Finish stop", "Terminar parada")}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** «📷 Añadir recibo» (o «Añadir foto») de una parada ya cerrada: la foto con cámara o galería, y monto (y galones, si es de
 *  gasolina). La hora y el lugar no cambian. */
export function DialogoDeReciboPendiente({ p, t, lang, ocupado, error, onCancelar, onConfirmar }: {
  p: Pausa; t: Traductor; lang: "en" | "es"; ocupado: boolean; error: string | null;
  onCancelar: () => void; onConfirmar: (entrada: { foto: string | null; monto: string; galones: string }) => void;
}) {
  const gas = pideRecibo(p.motivo);
  const [fotos, setFotos] = useState<string[]>([]);
  const [monto, setMonto] = useState("");
  const [galones, setGalones] = useState("");
  const entrada = { foto: fotos[0] ?? null, monto, galones };
  const recibo = reciboTardio(entrada, p.motivo);
  const falta = "falta" in recibo ? recibo.falta : null;
  const titulo = gas ? `🧾 ${t("Add receipt", "Añadir recibo")}` : `📷 ${t("Add photo", "Añadir foto")}`;
  return (
    <div className="overlay" data-dialogo-recibo-despues onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: 440 }}>
        <h3 style={{ marginTop: 0 }}>{titulo}</h3>
        <div className="hint" style={{ marginBottom: 8 }}>
          {nombreDelMotivo(p.motivo, lang)} · {fechaYHora(p.empezo_at)} {t("(the stop time stays the same)", "(la hora de la parada no cambia)")}
        </div>
        <div data-foto-recibo>
          <PhotoUpload photos={fotos} onChange={(n) => setFotos(n.slice(0, 1))} max={1} t={t} disabled={ocupado} galeria />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label>{t("Amount $ (optional)", "Monto $ (opcional)")}</label>
            <input data-monto inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} style={{ width: "100%" }} />
          </div>
          {gas && (
            <div className="field" style={{ flex: 1, minWidth: 0 }}>
              <label>{t("Gallons (optional)", "Galones (opcional)")}</label>
              <input data-galones inputMode="decimal" value={galones} onChange={(e) => setGalones(e.target.value)} style={{ width: "100%" }} />
            </div>
          )}
        </div>
        {falta === "monto" && <div className="hint" style={{ color: "var(--red)" }}>{t("The amount must be a number.", "El monto tiene que ser un número.")}</div>}
        {falta === "galones" && <div className="hint" style={{ color: "var(--red)" }}>{t("Gallons must be a number.", "Los galones tienen que ser un número.")}</div>}
        {error && <div className="hint" data-error-de-pausa style={{ color: "var(--red)", marginTop: 6 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" style={BOTON} onClick={onCancelar}>{t("Cancel", "Cancelar")}</button>
          <button data-confirmar-recibo-despues className="btn btn-green" style={BOTON} disabled={!!falta || ocupado} onClick={() => onConfirmar(entrada)}>
            {ocupado ? t("Saving…", "Guardando…") : `✔ ${t("Save", "Guardar")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
