"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cuentaSinVer, leeVistos, type ClienteDeVistas } from "@/lib/tutorial-views";
import type { Tutorial } from "@/lib/types";
import { appForPath } from "@/lib/app-for-path";
import { avisoGeneralEnLaRuta } from "@/lib/ensenanza-general";
import { PrefsConIdioma, usePrefs } from "@/lib/prefs";
import { ConfirmProvider } from "@/lib/confirm";
import { ayudaEnLaRuta } from "@/lib/ayuda-flotante";
import { botonDeVista, enlaceAVistaMovil } from "@/lib/mobile-preview";
import {
  EVENTO_ABRIR_AYUDA, EVENTO_ABRIR_CHAT, EVENTO_CHAT_SIN_LEER, EVENTO_ENSENANZA, RUTA_TUTORIALES,
  destinoDeLaApp, escribeEnsenanza, leeEnsenanza, opcionesDelBotonGeneral, type OpcionGeneral,
} from "@/lib/boton-general";
import { burbujaEnLaRuta, colorDeLaBurbuja, textosDeSuplantacion } from "@/lib/suplantacion-en-burbuja";
import { traduce } from "@/lib/aviso-de-suplantacion";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import { BotonVolverAMiUsuario, EtiquetaDeSuplantacion, useSuplantacion } from "@/components/SuplantacionEnBurbuja";
import type { NamedLocation, Profile } from "@/lib/types";

type Servidor = { adminReal: boolean; habilitado: boolean; users: Profile[]; stores: NamedLocation[] };
const SIN_SERVIDOR: Servidor = { adminReal: false, habilitado: false, users: [], stores: [] };

/**
 * La burbuja general (D-623, 2026-10-21): un solo botón abajo a la derecha, en todas las apps donde salía la Ayuda
 * (`ayudaEnLaRuta`), que al pulsarlo despliega hacia arriba sus opciones. Ayuda y Chat siguen siendo sus componentes
 * (`HelpButton`, `ChatFlotante`, montados sin burbuja propia): aquí solo se les pide abrirse con un evento. Cambiar
 * usuario, Vista móvil y Modo enseñanza salen solo al admin real, según diga `/api/impersonate/candidates`.
 *
 * Dentro de «Entrar como» (D-859) la burbuja se pone NARANJA y dice «Estás como Ernesto», con un botón ROJO encima
 * para volver a la cuenta propia; ya no hay franja arriba. Pulsarla abre el mismo menú, con «Cambiar usuario» (saltar a
 * otra persona) y «Vista móvil». Lo que la suplantación hace por debajo, en `useSuplantacion`; esas piezas hablan el
 * idioma del admin (D-516), no el de la persona en la que se entró.
 */
export function BotonGeneral() {
  const { t, lang } = usePrefs();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [servidor, setServidor] = useState<Servidor>(SIN_SERVIDOR);
  const [sinLeer, setSinLeer] = useState(0);
  const [ensenanza, setEnsenanza] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const sup = useSuplantacion();
  const suplantando = sup.estado !== null;
  const ayudaAqui = ayudaEnLaRuta(pathname);
  const sale = burbujaEnLaRuta(pathname, suplantando);

  useEffect(() => {
    if (!ayudaAqui) return;
    let vivo = true;
    fetch("/api/impersonate/candidates")
      .then((r) => (r.ok ? r.json() : SIN_SERVIDOR))
      .then((d: Partial<Servidor>) => {
        if (!vivo) return;
        setServidor({
          adminReal: d.adminReal === true,
          habilitado: d.habilitado === true,
          users: Array.isArray(d.users) ? d.users : [],
          stores: Array.isArray(d.stores) ? d.stores : [],
        });
      })
      .catch(() => { /* sin respuesta: solo Ayuda y Chat, la dirección segura */ });
    return () => { vivo = false; };
  }, [ayudaAqui]);

  useEffect(() => {
    setEnsenanza(leeEnsenanza(typeof localStorage === "undefined" ? null : localStorage));
    const alCambiar = () => setEnsenanza(leeEnsenanza(localStorage));
    const alContar = (e: Event) => setSinLeer(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener(EVENTO_ENSENANZA, alCambiar);
    window.addEventListener(EVENTO_CHAT_SIN_LEER, alContar);
    return () => {
      window.removeEventListener(EVENTO_ENSENANZA, alCambiar);
      window.removeEventListener(EVENTO_CHAT_SIN_LEER, alContar);
    };
  }, []);

  // Al cambiar de pantalla se cierra, como cualquier menú.
  useEffect(() => { setAbierto(false); setCambiando(false); }, [pathname]);

  // D-913: cuántos tutoriales de su rol le faltan por ver, para la insignia de «Tutoriales». Se pregunta al ABRIR el
  // menú (no en cada pantalla), una vez por carga; sin sesión, sin la 267 o con fallo, no hay insignia.
  const [sinVer, setSinVer] = useState<number | null>(null);
  useEffect(() => {
    if (!abierto || sinVer !== null) return;
    let vivo = true;
    void (async () => {
      const cliente = createClient();
      // La sesión local basta para saber quién es (sin viaje al servidor de auth); la RLS acota lo que se lee.
      const user = (await cliente.auth.getSession()).data.session?.user ?? null;
      if (!user) { if (vivo) setSinVer(0); return; }
      const [lista, vistos] = await Promise.all([cliente.rpc("tutorials"), leeVistos(cliente as unknown as ClienteDeVistas, user.id)]);
      if (!vivo) return;
      setSinVer(lista.error || !vistos.ok ? 0 : cuentaSinVer((lista.data ?? []) as Tutorial[], vistos.vistos));
    })();
    return () => { vivo = false; };
  }, [abierto, sinVer]);

  if (!sale) return null;

  const opciones = opcionesDelBotonGeneral({ adminReal: servidor.adminReal, switchHabilitado: servidor.habilitado, suplantando, ayudaAqui });
  const cierra = () => { setAbierto(false); setCambiando(false); };
  // Dentro de una suplantación, lo que era de la franja habla el idioma del ADMIN (D-516).
  const tAdmin = sup.estado ? traduce(sup.estado.idioma) : t;
  const textos = sup.estado ? textosDeSuplantacion({ ...sup.estado, volviendo: sup.volviendo }) : null;
  const alternaSalto = async () => {
    if (cambiando) { setCambiando(false); return; }
    setCambiando(true);
    if (!(await sup.pideCandidatos())) setCambiando(false);   // apagada, o una cookie que no cuadra: sin lista
  };
  const alternaEnsenanza = () => {
    const nuevo = !ensenanza;
    escribeEnsenanza(localStorage, nuevo, { doc: document, idioma: lang });
    setEnsenanza(nuevo);
    window.dispatchEvent(new CustomEvent(EVENTO_ENSENANZA));
    cierra();
    // Time Tracker monta su capacitación al cargar (D-490), y las demás apps tienen en memoria lo que leyeron: se recarga
    // para que entren en la práctica, o salgan de ella con todo como estaba (D-628). Entregas cambia sola con el evento.
    const app = appForPath(pathname);
    if (app === "timetracker" || app === "clockin" || avisoGeneralEnLaRuta(pathname)) window.location.reload();
  };

  const opcion = (o: OpcionGeneral) => {
    switch (o) {
      case "ayuda":
        return (
          <button key={o} type="button" className="fab-opcion" data-opcion={o} role="menuitem"
            onClick={() => { cierra(); window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_AYUDA)); }}>
            <span aria-hidden>?</span> {t("Help", "Ayuda")}
          </button>
        );
      case "chat":
        return (
          <button key={o} type="button" className="fab-opcion" data-opcion={o} role="menuitem"
            onClick={() => { cierra(); window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_CHAT)); }}>
            <span aria-hidden>💬</span> {t("Chat", "Chat")}
            {sinLeer > 0 && <span className="chat-badge chat-badge-fila" data-sin-leer={sinLeer}>{sinLeer > 99 ? "99+" : sinLeer}</span>}
          </button>
        );
      case "tutoriales":
        return (
          <Link key={o} className="fab-opcion" data-opcion={o} role="menuitem" href={RUTA_TUTORIALES} onClick={cierra}
            title={t("Training videos for your role", "Videos de capacitación para tu rol")}>
            <span aria-hidden>🎬</span> {t("Tutorials", "Tutoriales")}
            {(sinVer ?? 0) > 0 && <span className="chat-badge chat-badge-fila" data-tutoriales-sin-ver={sinVer}>{sinVer! > 99 ? "99+" : sinVer}</span>}
          </Link>
        );
      case "usuario":
        // Dentro de una suplantación, saltar a otra persona (D-307): la lista la da el servidor con la regla del admin de
        // la cookie, y el panel va con el idioma del admin (`PrefsConIdioma`, D-516) y su `ConfirmProvider` (D-321).
        if (sup.estado) {
          return (
            <div key={o} style={{ position: "relative" }}>
              <button type="button" className={"fab-opcion" + (cambiando ? " on" : "")} data-opcion={o} role="menuitem"
                aria-expanded={cambiando} disabled={sup.volviendo} onClick={() => void alternaSalto()}>
                <span aria-hidden>⇄</span> {tAdmin("Switch user", "Cambiar usuario")}
              </button>
              {cambiando && sup.candidatos && (
                <PrefsConIdioma lang={sup.estado.idioma}>
                  <ConfirmProvider>
                    <SwitchUserPanel users={sup.candidatos.users} tiendas={sup.candidatos.stores} modo="saltar" onClose={() => setCambiando(false)} destino={destinoDeLaApp(pathname)} />
                  </ConfirmProvider>
                </PrefsConIdioma>
              )}
            </div>
          );
        }
        return (
          <div key={o} style={{ position: "relative" }}>
            <button type="button" className={"fab-opcion" + (cambiando ? " on" : "")} data-opcion={o} role="menuitem"
              aria-expanded={cambiando} onClick={() => setCambiando((v) => !v)}>
              <span aria-hidden>⇄</span> {t("Switch user", "Cambiar usuario")}
            </button>
            {cambiando && (
              <ConfirmProvider>
                <SwitchUserPanel users={servidor.users} tiendas={servidor.stores} onClose={() => setCambiando(false)} destino={destinoDeLaApp(pathname)} />
              </ConfirmProvider>
            )}
          </div>
        );
      case "movil":
        // Dentro de una suplantación, el botón de vista de la franja (D-516): «Vista móvil» fuera del marco y «Vista de
        // escritorio» dentro (o en la propia vista móvil), navegando la pestaña de arriba.
        if (sup.estado) {
          const escritorio = botonDeVista({ enMarco: sup.enMarco, pathname: pathname || "/" }).vista === "escritorio";
          return (
            <button key={o} type="button" className="fab-opcion" data-opcion={o} data-cambia-vista={escritorio ? "escritorio" : "movil"}
              role="menuitem" disabled={sup.volviendo} onClick={() => { cierra(); sup.cambiarDeVista(); }}
              title={escritorio
                ? tAdmin("Take this screen out of the phone frame, at full size", "Sacar esta pantalla del marco de teléfono, a tamaño normal")
                : tAdmin("See this screen as it looks on a phone", "Ver esta pantalla como se ve en un teléfono")}>
              <span aria-hidden>{escritorio ? "🖥️" : "📱"}</span> {escritorio ? tAdmin("Desktop view", "Vista de escritorio") : tAdmin("Mobile view", "Vista móvil")}
            </button>
          );
        }
        return (
          <a key={o} className="fab-opcion" data-opcion={o} role="menuitem" href={enlaceAVistaMovil(pathname || "/")}
            title={t("See this screen as it looks on a phone", "Ver esta pantalla como se ve en un teléfono")}>
            <span aria-hidden>📱</span> {t("Mobile view", "Vista móvil")}
          </a>
        );
      case "ensenanza":
        return (
          <button key={o} type="button" className={"fab-opcion" + (ensenanza ? " on" : "")} data-opcion={o}
            role="menuitemcheckbox" aria-checked={ensenanza} onClick={alternaEnsenanza}
            title={t(
              "Practice in every app with the real data: what you change shows as saved, nobody else sees it, and turning it off puts everything back.",
              "Práctica en todas las apps con los datos reales: lo que cambies se ve guardado, nadie más lo ve, y al apagarlo todo vuelve a como estaba.",
            )}>
            <span aria-hidden>🎓</span> {ensenanza ? t("Turn teaching mode off", "Apagar modo enseñanza") : t("Teaching mode", "Modo enseñanza")}
          </button>
        );
    }
  };

  const naranja = colorDeLaBurbuja(sup.estado) === "naranja";
  const nombre = abierto ? (textos ? tAdmin("Close", "Cerrar") : t("Close", "Cerrar")) : (textos ? textos.titulo : t("Help, chat and more", "Ayuda, chat y más"));

  return (
    <div className={"fab-general-caja no-print" + (naranja ? " suplantando" : "")} data-boton-general>
      {abierto && (
        <>
          <div className="fab-fondo" onClick={cierra} />
          <div className="fab-menu" role="menu" aria-label={t("Options", "Opciones")}>
            {opciones.map(opcion)}
          </div>
          {/* D-486: esa persona tiene una contraseña temporal; a ella se le pide cambiarla, al admin no. Fuera del menú
              (no es una opción), entre el menú y el botón rojo. */}
          {textos?.contrasena && <div className="fab-nota" role="note" data-aviso="cambio-contrasena">{textos.contrasena}</div>}
        </>
      )}
      {/* D-859: el botón rojo, justo encima de la burbuja naranja. Es la vuelta de siempre (`volverAMiCuenta`). */}
      {sup.estado && <BotonVolverAMiUsuario suplantacion={sup.estado} volviendo={sup.volviendo} onVolver={() => void sup.volver("manual")} />}
      <button
        type="button"
        className={"fab-general" + (abierto ? " abierto" : "") + (naranja ? " suplantando" : "")}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        title={nombre}
        aria-label={nombre}
      >
        {sup.estado && <EtiquetaDeSuplantacion suplantacion={sup.estado} />}
        <span aria-hidden>{abierto ? "✕" : "?"}</span>
        {!abierto && sinLeer > 0 && <span className="chat-badge" data-sin-leer={sinLeer}>{sinLeer > 99 ? "99+" : sinLeer}</span>}
      </button>
    </div>
  );
}
