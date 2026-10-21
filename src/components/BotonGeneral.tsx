"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { ConfirmProvider } from "@/lib/confirm";
import { ayudaEnLaRuta } from "@/lib/ayuda-flotante";
import { enlaceAVistaMovil } from "@/lib/mobile-preview";
import {
  EVENTO_ABRIR_AYUDA, EVENTO_ABRIR_CHAT, EVENTO_CHAT_SIN_LEER, EVENTO_ENSENANZA,
  destinoDeLaApp, escribeEnsenanza, leeEnsenanza, opcionesDelBotonGeneral, type OpcionGeneral,
} from "@/lib/boton-general";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import type { NamedLocation, Profile } from "@/lib/types";

type Servidor = { adminReal: boolean; habilitado: boolean; users: Profile[]; stores: NamedLocation[] };
const SIN_SERVIDOR: Servidor = { adminReal: false, habilitado: false, users: [], stores: [] };

/**
 * La burbuja general (D-623, 2026-10-21): un solo botón abajo a la derecha, en todas las apps donde salía la Ayuda
 * (`ayudaEnLaRuta`), que al pulsarlo despliega hacia arriba sus opciones. Ayuda y Chat siguen siendo sus componentes
 * (`HelpButton`, `ChatFlotante`, montados sin burbuja propia): aquí solo se les pide abrirse con un evento. Cambiar
 * usuario, Vista móvil y Modo enseñanza salen solo al admin real, según diga `/api/impersonate/candidates`.
 */
export function BotonGeneral() {
  const { t } = usePrefs();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [servidor, setServidor] = useState<Servidor>(SIN_SERVIDOR);
  const [sinLeer, setSinLeer] = useState(0);
  const [ensenanza, setEnsenanza] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const sale = ayudaEnLaRuta(pathname);

  useEffect(() => {
    if (!sale) return;
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
  }, [sale]);

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

  if (!sale) return null;

  const opciones = opcionesDelBotonGeneral({ adminReal: servidor.adminReal, switchHabilitado: servidor.habilitado });
  const cierra = () => { setAbierto(false); setCambiando(false); };
  const alternaEnsenanza = () => {
    const nuevo = !ensenanza;
    escribeEnsenanza(localStorage, nuevo);
    setEnsenanza(nuevo);
    window.dispatchEvent(new CustomEvent(EVENTO_ENSENANZA));
    cierra();
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
      case "usuario":
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
              "A private practice sandbox on top of the real orders in Deliveries: nothing you do is saved or seen by anyone else.",
              "Un entorno de práctica privado sobre las órdenes reales de Entregas: nada de lo que hagas se guarda ni lo ve nadie más.",
            )}>
            <span aria-hidden>🎓</span> {ensenanza ? t("Turn teaching mode off", "Apagar modo enseñanza") : t("Teaching mode", "Modo enseñanza")}
          </button>
        );
    }
  };

  return (
    <div className="fab-general-caja no-print" data-boton-general>
      {abierto && (
        <>
          <div className="fab-fondo" onClick={cierra} />
          <div className="fab-menu" role="menu" aria-label={t("Options", "Opciones")}>
            {opciones.map(opcion)}
          </div>
        </>
      )}
      <button
        type="button"
        className={"fab-general" + (abierto ? " abierto" : "")}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        title={abierto ? t("Close", "Cerrar") : t("Help, chat and more", "Ayuda, chat y más")}
        aria-label={abierto ? t("Close", "Cerrar") : t("Help, chat and more", "Ayuda, chat y más")}
      >
        <span aria-hidden>{abierto ? "✕" : "?"}</span>
        {!abierto && sinLeer > 0 && <span className="chat-badge" data-sin-leer={sinLeer}>{sinLeer > 99 ? "99+" : sinLeer}</span>}
      </button>
    </div>
  );
}
