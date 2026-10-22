"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { APP_VERSIONS } from "@/lib/app-versions";
import { appForPath } from "@/lib/app-for-path";
import { Z_PANEL_DE_AYUDA, ayudaEnLaRuta, type ContactoDeAyuda } from "@/lib/ayuda-flotante";
import { telClean } from "@/lib/utils";
import Link from "next/link";
import { LIMITES_DE_ADJUNTOS, mensajeDeAdjunto, validaAdjuntos } from "@/lib/help-attachments";
import {
  conAyudaOculta, falloDeCaptura, mensajeDeFalloDeCaptura, soportaCaptura, validaCaptura,
} from "@/lib/help-captura";
import { mensajeConProblemas, type RecuadroNumerado } from "@/lib/help-recuadros";
import {
  EditorDeCaptura, calientaCaptura, esperaUnRepintado, ficheroDeCaptura, marcaFueraDeLaCaptura,
  tomaFotograma, tomaFotogramaDeLaPagina, type FotogramaDeCaptura,
} from "@/components/CapturaDeAyuda";
import { enviaSolicitudDeAyuda, pideContactoDeAyuda, rolDeQuienEscribe } from "@/lib/help-send";
import { RUTA_MIS_SOLICITUDES } from "@/lib/help-thread";
import { EVENTO_ABRIR_AYUDA } from "@/lib/boton-general";

/** Cuánto se ve el aviso de abajo (enviada, no se pudo…), como el de Entregas. */
const DURACION_DEL_AVISO_MS = 4000;

/**
 * La burbuja de Ayuda, la MISMA en todas las apps (D-530): «? Help» abajo a la derecha, su panel, la foto de la
 * pantalla (D-509, D-513) y el enlace a «Mis solicitudes» (D-311). Cualquiera la pulsa y manda un correo a la
 * dirección de ayuda de Ajustes, con quién es, en qué página está y la versión de esa app, para que quien la lee
 * pueda actuar sin preguntar. Va por `/api/help` (Resend); sin correo configurado lo dice.
 *
 * **Se monta UNA vez, en el layout raíz** (`app/layout.tsx`), que es el único por el que pasan todas las apps: así
 * es el mismo componente —no una copia por app— en Entregas, el hub, Time Tracker, RR. HH., el ERP, Quote Builder,
 * Leads, Encuestas y Promociones, y una app nueva la tiene sin acordarse. Dónde NO sale lo dice `ayudaEnLaRuta`
 * (las pantallas sin sesión: login, el enlace del cliente…).
 *
 * Hasta D-530 vivía solo en Entregas y sacaba dos cosas de su `DataProvider`: los ajustes de ayuda y el aviso de
 * abajo. Ya no depende de ninguna app: quién escribe y el teléfono los pide a `/api/help` al abrirse
 * (`pideContactoDeAyuda`), y el aviso es suyo. Por eso se ve y se comporta igual en todas.
 */
/**
 * `sinBurbuja` (D-623, 2026-10-21): el layout raíz monta la burbuja general (`BotonGeneral`), que es la única que se ve;
 * este componente entonces no pinta su «? Ayuda» y se abre cuando la general lo pide por evento. Sin la prop sigue
 * pintando su burbuja, como hasta D-623.
 */
export function HelpButton({ sinBurbuja = false }: { sinBurbuja?: boolean } = {}) {
  const { lang, t } = usePrefs();
  const pathname = usePathname();
  // El aviso de abajo es de la burbuja, no de la app en la que está: así dice lo mismo, en el mismo sitio, en
  // todas. Antes era el `notify` de Entregas, que fuera de Entregas no existe.
  const [aviso, setAviso] = useState<string | null>(null);
  const notify = (m: string) => setAviso(m);
  useEffect(() => {
    if (!aviso) return;
    const id = setTimeout(() => setAviso(null), DURACION_DEL_AVISO_MS);
    return () => clearTimeout(id);
  }, [aviso]);
  // Quién escribe y el teléfono de ayuda: se piden al abrir (ver `pideContactoDeAyuda`), una vez por carga.
  const [contacto, setContacto] = useState<ContactoDeAyuda | null>(null);
  const traeContacto = async (): Promise<ContactoDeAyuda | null> => {
    if (contacto) return contacto;
    const c = await pideContactoDeAyuda();
    if (c) setContacto(c);
    return c;
  };

  const [open, setOpen] = useState(false);
  useEffect(() => {
    const abre = () => { setOpen(true); calientaCaptura(); void traeContacto(); };
    window.addEventListener(EVENTO_ABRIR_AYUDA, abre);
    return () => window.removeEventListener(EVENTO_ABRIR_AYUDA, abre);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // Documentos y fotos (D-284): se eligen aquí, se suben al cubo privado al enviar, y al correo van
  // sus enlaces firmados. Lo que se acepta lo dice `help-attachments`, el mismo sitio que mira la ruta.
  const [ficheros, setFicheros] = useState<File[]>([]);
  // La captura de pantalla (D-509, D-513). `fotograma` es la captura esperando a que se señale el
  // problema. `ocultoParaCapturar` esconde Ayuda ENTERA, pero solo en el respaldo del navegador: la foto
  // rápida no la esconde, la deja fuera al clonar.
  const [ocultoParaCapturar, setOcultoParaCapturar] = useState(false);
  const [fotograma, setFotograma] = useState<FotogramaDeCaptura | null>(null);
  const [adjuntando, setAdjuntando] = useState(false);
  // La foto rápida (D-513) tarda 0,25–0,6 s en caliente y hasta 2 s la primera vez: el botón se
  // apaga mientras tanto, o un segundo clic lanzaría una segunda captura encima de la primera.
  const [capturando, setCapturando] = useState(false);
  // El método del navegador (D-509) solo aparece si la rápida falla: pide permiso cada vez, y eso
  // es justo lo que el dueño no quiere ver en el camino normal.
  const [respaldoVisible, setRespaldoVisible] = useState(false);

  // ¿Sabe este navegador capturar la pantalla con `getDisplayMedia`? Solo decide el RESPALDO: la foto
  // rápida no lo necesita y se ofrece siempre, también en el móvil (D-513). Se mide, no se adivina por
  // el agente de usuario. Solo se lee dentro del panel, que nunca se pinta en el servidor (nace
  // cerrado), así que no hay nada que hidratar distinto.
  const puedeCapturar = soportaCaptura(typeof navigator === "undefined" ? null : navigator);

  const close = () => { if (!busy) { setOpen(false); setMsg(""); setFicheros([]); setFotograma(null); } };

  const agregaFicheros = (elegidos: File[]) => {
    if (!elegidos.length) return;
    const juntos = [...ficheros, ...elegidos];
    const fallo = validaAdjuntos(juntos);
    if (fallo) { notify(mensajeDeAdjunto(fallo, t)); return; }
    setFicheros(juntos);
  };

  const eligeFicheros = (lista: FileList | null) => agregaFicheros([...(lista ?? [])]);

  /**
   * La foto de siempre (D-513): un clic, sin diálogo del navegador, lo que se ve ahora. Ayuda no sale
   * porque se deja fuera al clonar (`marcaFueraDeLaCaptura`), no porque se esconda: no parpadea y no
   * hay que esperar un repintado.
   *
   * Si falla, se dice y aparece el método del navegador, que es más lento pero fotografía la pantalla
   * real y por eso no depende de cómo esté hecha la página.
   */
  const capturaRapida = async () => {
    if (capturando) return;
    setCapturando(true);
    try {
      setFotograma(await tomaFotogramaDeLaPagina());
      setRespaldoVisible(false);
    } catch {
      setRespaldoVisible(true);
      notify(t(
        "The quick screenshot didn't work. You can take it with the browser instead — it will ask what to share.",
        "La captura rápida no salió. Puede tomarla con el navegador — le preguntará qué compartir.",
      ));
    } finally {
      setCapturando(false);
    }
  };

  /**
   * El respaldo (D-509). «Sin que la parte de help aparezca»: Ayuda se deja de dibujar —el panel **y**
   * el botón flotante—, se espera a que el navegador haya repintado sin ella, y solo entonces se pide
   * la pantalla. El orden y el regreso viven en `conAyudaOculta`, con sus pruebas.
   *
   * El diálogo del navegador es inevitable por esta vía: capturar la pantalla exige un gesto y su
   * propia confirmación. Si se cancela, no pasa nada: se dice y queda el camino de adjuntar a mano.
   */
  const capturaConElNavegador = async () => {
    if (!puedeCapturar) { notify(mensajeDeFalloDeCaptura("no-soportado", t)); return; }
    try {
      setFotograma(await conAyudaOculta({
        esconde: () => setOcultoParaCapturar(true),
        esperaUnRepintado,
        captura: tomaFotograma,
        devuelve: () => setOcultoParaCapturar(false),
      }));
    } catch (e) {
      notify(mensajeDeFalloDeCaptura(falloDeCaptura(e), t));
    }
  };

  /** Lo que se adjunta es la imagen con los recuadros numerados ya pintados, y entra por la misma puerta
   *  que un fichero elegido a mano: las mismas reglas, el mismo cubo, el mismo correo. Los problemas de
   *  cada recuadro van al mensaje como «1) … 2) …» (D-583): una solicitud, un hilo, y la persona los ve
   *  en el cuadro de texto y los puede retocar antes de enviar. */
  const adjuntaCaptura = async (recuadros: RecuadroNumerado[]) => {
    const tomada = fotograma;
    if (!tomada) return;
    setAdjuntando(true);
    try {
      const imagen = await ficheroDeCaptura(tomada, recuadros, new Date());
      const malo = validaCaptura(imagen);
      if (malo) { notify(mensajeDeAdjunto(malo, t)); return; }
      agregaFicheros([imagen]);
      setMsg((actual) => mensajeConProblemas(actual, recuadros, t));
      setFotograma(null);
    } catch (e) {
      notify(mensajeDeFalloDeCaptura(falloDeCaptura(e), t));
    } finally {
      setAdjuntando(false);
    }
  };

  const send = async () => {
    const message = msg.trim();
    if (!message) return;
    setBusy(true);
    // Quién escribe lo dice la sesión, no la app en la que está la burbuja (D-530). Sin sesión no se manda.
    const quien = await traeContacto();
    if (!quien) {
      setBusy(false);
      notify(t(
        "Couldn't send — your session may have expired. Sign in again and retry.",
        "No se pudo enviar — puede que su sesión haya caducado. Vuelva a entrar e inténtelo de nuevo.",
      ));
      return;
    }
    // Subir y mandar viven en `help-send`, que también usa «Mis solicitudes» del hub (D-311). El destino del
    // correo lo pone el servidor (`destinoDeAyuda`).
    const r = await enviaSolicitudDeAyuda({
      userId: quien.id, message, ficheros, page: pathname, senderName: quien.nombre,
      role: rolDeQuienEscribe(quien.rol, lang),
      // La versión de la app en la que está, no siempre la de Entregas: el número que sale arriba a la derecha.
      appVersion: APP_VERSIONS[appForPath(pathname)],
      lang,
    });
    setBusy(false);
    if (r.tipo === "enviada") {
      notify(t("Help request sent — we'll get back to you.", "Solicitud de ayuda enviada — le responderemos."));
      setOpen(false); setMsg(""); setFicheros([]);
    } else if (r.tipo === "sin-correo") {
      // Email provider not live yet: don't pretend it was delivered.
      notify(t(
        "Email isn't set up yet, so your request wasn't delivered. Ask an admin to finish email setup.",
        "El correo aún no está configurado, así que su solicitud no se envió. Pida a un administrador que termine la configuración.",
      ));
      setOpen(false); setMsg("");
    } else if (r.tipo === "subida") {
      notify(t(`Couldn't upload “${r.fichero}”. Nothing was sent.`, `No se pudo subir «${r.fichero}». No se envió nada.`));
    } else if (r.tipo === "red") {
      notify(t("Network error — please try again.", "Error de red — intente de nuevo."));
    } else {
      notify(t("Couldn't send — please try again.", "No se pudo enviar — intente de nuevo."));
    }
  };

  // Ayuda fuera de la foto, en una sola línea: mientras se captura, este componente no dibuja NADA —ni
  // el botón flotante, ni el panel, ni el editor—. No se le baja la opacidad ni se saca con CSS: lo que
  // no está en el DOM no puede salir en el fotograma. Una condición, y no cuatro, para que no se quede
  // una pieza dentro. El estado —el mensaje a medio escribir, los adjuntos— sobrevive: devolver `null`
  // no desmonta el componente.
  if (ocultoParaCapturar) return null;
  // Las pantallas de antes (o de fuera) de las apps no la llevan: el login, el enlace del cliente… (D-530).
  if (!ayudaEnLaRuta(pathname)) return null;

  return (
    <>
      {!sinBurbuja && <button
        className="help-fab no-print"
        {...marcaFueraDeLaCaptura}
        // Al abrir se calienta la foto rápida (lo lento de la primera, las fuentes, pasa mientras se escribe) y se
        // pide quién escribe y el teléfono, para que el «📞 Llámanos» salga ya con el panel.
        onClick={() => { setOpen(true); calientaCaptura(); void traeContacto(); }}
        title={t("Need help?", "¿Necesita ayuda?")}
        aria-label={t("Need help?", "¿Necesita ayuda?")}
      >
        <span aria-hidden>?</span>
        <span className="help-fab-label">{t("Help", "Ayuda")}</span>
      </button>}

      {open && (
        // Por encima de cualquier ventana (D-NEXT): Melecio la abrió con «Agregar material» abierto (60) y el panel salió
        // DEBAJO, con el `.overlay` de siempre (50). La burbuja ya iba encima de todo desde D-616; el panel no.
        <div className="overlay" style={{ zIndex: Z_PANEL_DE_AYUDA }} {...marcaFueraDeLaCaptura} onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3 style={{ margin: "0 0 4px" }}>{t("Need help?", "¿Necesita ayuda?")}</h3>
            <p className="hint" style={{ marginTop: 0 }}>
              {t(
                "Describe what's happening and we'll email support. We'll include your name, role, and the page you're on.",
                "Describa lo que sucede y enviaremos un correo a soporte. Incluiremos su nombre, rol y la página en la que está.",
              )}
            </p>
            {contacto?.telefono && (
              <a
                href={`tel:${telClean(contacto.telefono)}`}
                className="btn btn-green"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}
              >
                📞 {t("Call us", "Llámanos")} · {contacto.telefono}
              </a>
            )}
            <textarea
              rows={5}
              autoFocus
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={t("What do you need help with?", "¿En qué necesita ayuda?")}
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="field" style={{ marginTop: 10 }}>
              <label style={{ textTransform: "none", letterSpacing: 0 }}>
                {t("Photos or documents (optional)", "Fotos o documentos (opcional)")}
              </label>
              <input
                type="file"
                multiple
                accept={LIMITES_DE_ADJUNTOS.tipos.join(",")}
                disabled={busy}
                onChange={(e) => { eligeFicheros(e.target.files); e.target.value = ""; }}
              />
              <div className="hint">
                {t(
                  `Up to ${LIMITES_DE_ADJUNTOS.maxFicheros} files, ${Math.round(LIMITES_DE_ADJUNTOS.maxBytes / (1024 * 1024))} MB each. They travel as private links that expire.`,
                  `Hasta ${LIMITES_DE_ADJUNTOS.maxFicheros} archivos de ${Math.round(LIMITES_DE_ADJUNTOS.maxBytes / (1024 * 1024))} MB. Viajan como enlaces privados que caducan.`,
                )}
              </div>
              {/* La captura de la pantalla (D-509, D-513). Es una forma más de llenar esta misma lista
                  de adjuntos: no hay un camino aparte ni un cubo aparte. La rápida no depende de
                  `getDisplayMedia`, así que se ofrece siempre — también en el móvil, que antes no podía. */}
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8 }}
                disabled={busy || capturando}
                onClick={capturaRapida}
              >
                📸 {capturando ? t("Capturing…", "Capturando…") : t("Capture this screen", "Capturar esta pantalla")}
              </button>
              <div className="hint">
                {t(
                  "Takes what you're seeing right now, without this Help window. No permission needed.",
                  "Toma lo que está viendo ahora mismo, sin esta ventana de Ayuda. No pide permiso.",
                )}
              </div>
              {respaldoVisible && (puedeCapturar ? (
                <>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 8 }}
                    disabled={busy}
                    onClick={capturaConElNavegador}
                  >
                    🖥️ {t("Capture with the browser", "Capturar con el navegador")}
                  </button>
                  <div className="hint">
                    {t(
                      "Your browser will ask what to share — that's its own dialog and we can't skip it.",
                      "El navegador le preguntará qué compartir — ese diálogo es suyo y no se puede saltar.",
                    )}
                  </div>
                </>
              ) : (
                <div className="hint">{mensajeDeFalloDeCaptura("no-soportado", t)}</div>
              ))}
              {ficheros.length > 0 && (
                <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 4 }}>
                  {ficheros.map((f, i) => (
                    <li key={`${f.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📎 {f.name}</span>
                      <span className="hint" style={{ margin: 0 }}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => setFicheros((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={t(`Remove ${f.name}`, `Quitar ${f.name}`)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {/* Las respuestas llegan a «Mis solicitudes», en el hub: la conversación vive allí (D-311). */}
            <Link href={RUTA_MIS_SOLICITUDES} className="hint" style={{ display: "inline-block", marginTop: 10 }}>
              💬 {t("My requests and replies", "Mis solicitudes y respuestas")}
            </Link>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={close} disabled={busy}>{t("Cancel", "Cancelar")}</button>
              <button className="btn btn-primary" onClick={send} disabled={busy || !msg.trim()}>
                {busy ? t("Sending…", "Enviando…") : t("Send", "Enviar")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Señalar el problema. Va encima del panel y el panel se queda detrás con el mensaje intacto. */}
      {fotograma && (
        <EditorDeCaptura
          fotograma={fotograma}
          t={t}
          ocupado={adjuntando}
          onUsar={adjuntaCaptura}
          onDescartar={() => setFotograma(null)}
          onDeNuevo={() => { setFotograma(null); void capturaRapida(); }}
        />
      )}

      {/* El aviso de la burbuja: fuera de la foto, como lo demás de Ayuda. */}
      {aviso && <div className="toast no-print" role="status" style={{ zIndex: Z_PANEL_DE_AYUDA + 20 }} {...marcaFueraDeLaCaptura}>{aviso}</div>}
    </>
  );
}
