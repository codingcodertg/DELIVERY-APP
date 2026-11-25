"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { enAppDeEscritorio } from "@/lib/desktop-shell";
import { ayudaEnLaRuta } from "@/lib/ayuda-flotante";
import { usePrefs } from "@/lib/prefs";
import { useSuplantacion } from "@/components/SuplantacionEnBurbuja";
import {
  estadoDelHub, ficharDesdeElHub, empezarBreakDesdeElHub, volverDelBreakDesdeElHub, terminarTurnoDesdeElHub,
  type ResultadoDelHub,
} from "@/app/timetracker/clock-in/actions/hub";
import {
  ANCHO_MINIMO_DEL_HUB, accionDeTeclaEnBloqueo, demoDelHub, fechaDeTexas, formatoCronometro, formatoTranscurrido,
  horaCorta, horaDeTexas, reconciliaLectura, saludoDe, seVeElBoton, tiendaPorDefecto,
  type DatosDelHub, type EstadoDelHub,
} from "@/lib/timetracker/fichaje-del-hub";
import { claveTiendaDelDia, tiendaDelDiaDesde, valorTiendaDelDia } from "@/lib/timetracker/multitienda";

// La pantalla de fichar desde el hub de escritorio (2026-11-25). Reglas de pantalla:
//  · Solo en la app de escritorio (o en la demo con modo local): se mira ANTES de llamar al servidor, así que en un
//    navegador o un teléfono no sale ninguna llamada. Y por debajo de 700 px no se monta.
//  · Con el interruptor apagado se hace UNA llamada (la lectura) y no se vuelve a preguntar.
//  · La lectura se hace al cargar, al volver a la ventana y cada 30 s; las acciones devuelven el estado nuevo.
//  · El bloqueo del almuerzo no se puede cerrar con Escape ni con clics; el resto de la página queda `inert`.
//  · Un fallo de lectura conserva lo último que se supo: nunca bloquea ni desbloquea.

const CANAL = "rtg-fichaje-del-hub";
const CADA_LECTURA_MS = 30000;
const CLAVE_DE_DIA = (uid: string) => claveTiendaDelDia(uid);

export function FichajeDelHub() {
  const pathname = usePathname();
  const [escritorio, setEscritorio] = useState(false);
  const [ancho, setAncho] = useState(0);

  useEffect(() => {
    setEscritorio(enAppDeEscritorio(window) || demoDelHub(process.env.NEXT_PUBLIC_LOCAL_MODE === "true", process.env.NEXT_PUBLIC_DEMO_ESCRITORIO === "1"));
    const mide = () => setAncho(window.innerWidth);
    mide();
    window.addEventListener("resize", mide);
    return () => window.removeEventListener("resize", mide);
  }, []);

  // Sin escritorio, en el login o con un ancho chico: ni se monta, ni se llama al servidor.
  if (!escritorio || !ayudaEnLaRuta(pathname) || ancho < ANCHO_MINIMO_DEL_HUB) return null;
  return <FichajeDelHubDeEscritorio />;
}

function FichajeDelHubDeEscritorio() {
  const { t, lang } = usePrefs();
  const sup = useSuplantacion();
  const viendoComo = sup.estado !== null;
  const idBloqueo = useId();

  const [datos, setDatos] = useState<DatosDelHub | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [tienda, setTienda] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; error: boolean } | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const cajaRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const botonVolverRef = useRef<HTMLButtonElement>(null);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promptMostradoRef = useRef(false);
  const canal = useRef<BroadcastChannel | null>(null);

  const estadoActual: EstadoDelHub = datos?.estado ?? "fuera";
  const activo = !!datos?.activo && !viendoComo;
  const bloqueado = activo && estadoActual === "en_break";
  const verPrompt = activo && prompt && estadoActual === "fuera";
  const verMenu = activo && menu && estadoActual === "en_turno";
  const multi = !!datos && datos.multiTienda && datos.tiendas.length > 0;

  const mostrarAviso = useCallback((texto: string, error = false) => {
    setAviso({ texto, error });
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(null), error ? 5000 : 2600);
  }, []);

  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

  /** Una sola puerta para cambiar el estado: se difunde a las otras ventanas de la app para que el bloqueo salga en todas. */
  const aplicaEstado = useCallback((estado: EstadoDelHub, desde: string | null) => {
    setDatos((prev) => (prev ? { ...prev, estado, desde } : prev));
    canal.current?.postMessage({ estado, desde });
  }, []);

  const cargar = useCallback(async () => {
    let lectura: { ok: true; datos: DatosDelHub } | { ok: false };
    try {
      const r = await estadoDelHub();
      lectura = r.ok ? { ok: true, datos: r.datos } : { ok: false };
    } catch {
      lectura = { ok: false };
    }
    setDatos((prev) => reconciliaLectura(prev, lectura));
  }, []);

  // Primera lectura al montar. Después, solo si el interruptor está puesto (con el interruptor apagado, una llamada y ya).
  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    if (!activo) return;
    const iv = setInterval(() => void cargar(), CADA_LECTURA_MS);
    const alVolver = () => void cargar();
    window.addEventListener("focus", alVolver);
    return () => { clearInterval(iv); window.removeEventListener("focus", alVolver); };
  }, [activo, cargar]);

  // Otras ventanas de la misma app: el cambio sale en unos segundos sin esperar la lectura de 30 s.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(CANAL);
    canal.current = c;
    c.onmessage = (e: MessageEvent) => {
      const d = e.data as { estado?: EstadoDelHub; desde?: string | null } | null;
      if (!d || !d.estado) return;
      setDatos((prev) => (prev ? { ...prev, estado: d.estado as EstadoDelHub, desde: d.desde ?? null } : prev));
    };
    return () => { c.close(); canal.current = null; };
  }, []);

  // La primera vez que hay datos con el interruptor puesto: si no está fichado, la pregunta. Cada carga de la página.
  useEffect(() => {
    if (!datos || !datos.activo || promptMostradoRef.current) return;
    promptMostradoRef.current = true;
    if (datos.estado === "fuera") setPrompt(true);
  }, [datos]);

  // La tienda: la de la entrada abierta, si no la que recordó hoy, si no la primera.
  useEffect(() => {
    if (!datos || !datos.multiTienda) return;
    let recordada: string | null = null;
    try {
      recordada = tiendaDelDiaDesde(localStorage.getItem(CLAVE_DE_DIA(datos.uid)), fechaDeTexas(new Date()));
    } catch { /* sin almacenamiento: no hay recuerdo */ }
    // Solo rellena si aún no hay tienda: una lectura de refresco no debe pisar la que la persona ya eligió.
    setTienda((previa) => previa ?? tiendaPorDefecto({ tiendaDeHoy: datos.tiendaDeHoy, recordada, tiendas: datos.tiendas }));
  }, [datos]);

  // El reloj del almuerzo marca cada segundo; el de «en turno», cada minuto.
  useEffect(() => {
    setAhora(Date.now());
    const iv = setInterval(() => setAhora(Date.now()), estadoActual === "en_break" ? 1000 : 60000);
    return () => clearInterval(iv);
  }, [estadoActual]);

  // Fuera de la app de escritorio, nada de esto sale. Dentro: el bloqueo deja la página inerte (no se puede
  // pulsar ni enfocar nada detrás) y guarda el foco para devolverlo al salir.
  useEffect(() => {
    if (!bloqueado) return;
    const marcados: Element[] = [];
    for (const hijo of Array.from(document.body.children)) {
      if (hijo.hasAttribute("data-bloqueo-del-hub") || hijo.hasAttribute("inert")) continue;
      hijo.setAttribute("inert", "");
      marcados.push(hijo);
    }
    const antes = document.activeElement as HTMLElement | null;
    botonVolverRef.current?.focus();
    return () => {
      marcados.forEach((e) => e.removeAttribute("inert"));
      antes?.focus?.();
    };
  }, [bloqueado]);

  // Escape no cierra el bloqueo; Tab se queda dentro de él.
  useEffect(() => {
    if (!bloqueado) return;
    const alTeclear = (e: KeyboardEvent) => {
      const accion = accionDeTeclaEnBloqueo(e.key);
      if (accion === "ignorar") {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      const foco = overlayRef.current
        ? Array.from(overlayRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), select, input"))
        : [];
      e.preventDefault();
      if (foco.length === 0) return;
      const i = foco.indexOf(document.activeElement as HTMLElement);
      const siguiente = e.shiftKey
        ? (i <= 0 ? foco[foco.length - 1] : foco[i - 1])
        : (i === -1 || i === foco.length - 1 ? foco[0] : foco[i + 1]);
      siguiente.focus();
    };
    document.addEventListener("keydown", alTeclear, true);
    return () => document.removeEventListener("keydown", alTeclear, true);
  }, [bloqueado]);

  // Menú y pregunta: Escape y un clic fuera los cierran (no el bloqueo).
  useEffect(() => {
    if (!verMenu && !verPrompt) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(false); setConfirmar(false); setPrompt(false);
    };
    const alPulsar = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) { setMenu(false); setConfirmar(false); setPrompt(false); }
    };
    document.addEventListener("keydown", alTeclear);
    document.addEventListener("mousedown", alPulsar);
    return () => { document.removeEventListener("keydown", alTeclear); document.removeEventListener("mousedown", alPulsar); };
  }, [verMenu, verPrompt]);

  const textoDeError = (r: Extract<ResultadoDelHub, { ok: false }>): string => {
    if (r.codigo === "sesion") return t("Your session expired. Sign in again.", "Tu sesión venció. Vuelve a entrar.");
    if (r.codigo === "no_activo") return t("Clocking in from the hub is not turned on for you.", "Fichar desde el hub no está activado para ti.");
    if (r.codigo === "estado") {
      if (r.estado === "en_break") return t("You are on a break right now.", "Ahora estás en el almuerzo.");
      if (r.estado === "en_turno") return t("You are already on the clock.", "Ya estás fichado.");
      return t("You are not on the clock.", "No estás fichado.");
    }
    return t(`Could not do that: ${r.mensaje}`, `No se pudo: ${r.mensaje}`);
  };

  /** Ejecuta una acción del servidor. Aplica el estado que diga (también en el error) y avisa. */
  const accion = async (ejecuta: () => Promise<ResultadoDelHub>, exito: string | null, despues?: () => void) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await ejecuta();
      if (r.estado) aplicaEstado(r.estado, r.desde ?? null);
      if (r.ok) {
        despues?.();
        if (exito) mostrarAviso(exito);
      } else {
        if (r.codigo === "no_activo") setDatos((prev) => (prev ? { ...prev, activo: false } : prev));
        mostrarAviso(textoDeError(r), true);
      }
    } catch {
      mostrarAviso(t("Could not reach the server. Try again.", "No se pudo conectar con el servidor. Inténtalo de nuevo."), true);
    } finally {
      setOcupado(false);
    }
  };

  const fichar = () => accion(
    () => ficharDesdeElHub({ storeId: multi ? tienda : null }),
    t("You are on the clock", "Ya estás fichado"),
    () => {
      setPrompt(false);
      if (multi && tienda && datos) {
        try { localStorage.setItem(CLAVE_DE_DIA(datos.uid), valorTiendaDelDia(fechaDeTexas(new Date()), tienda)); } catch { /* sin almacenamiento: no se recuerda */ }
      }
    },
  );
  const empezarBreak = () => { setMenu(false); void accion(() => empezarBreakDesdeElHub(), null); };
  const volver = () => accion(() => volverDelBreakDesdeElHub(), t("Welcome back", "Bienvenido de vuelta"));
  const terminar = () => { setConfirmar(false); setMenu(false); void accion(() => terminarTurnoDesdeElHub(), t("Shift ended. See you tomorrow", "Turno terminado. Hasta mañana")); };

  const alPulsarBoton = () => {
    if (estadoActual === "fuera") { setMenu(false); setConfirmar(false); setPrompt((v) => !v); return; }
    setPrompt(false); setConfirmar(false); setMenu((v) => !v);
  };

  if (viendoComo || !datos || !datos.activo) return null;

  const hora = datos.desde ? horaCorta(datos.desde, lang) : "";
  const transcurrido = datos.desde ? Math.max(0, ahora - Date.parse(datos.desde)) : 0;
  const saludo = { manana: t("Good morning", "Buenos días"), tarde: t("Good afternoon", "Buenas tardes"), noche: t("Good evening", "Buenas noches") }[saludoDe(horaDeTexas(new Date()))];
  const primerNombre = datos.nombre.trim().split(" ")[0] ?? "";
  const etiquetaBoton = estadoActual === "fuera"
    ? t("Clock in", "Fichar")
    : estadoActual === "en_break"
      ? t(`On a break since ${hora}`, `En almuerzo desde las ${hora}`)
      : t(`On the clock since ${hora}`, `Fichado desde las ${hora}`);

  const selectorDeTienda = multi ? (
    <label className="fichaje-del-hub-campo">
      <span>{t("Store", "Tienda")}</span>
      <select className="fichaje-del-hub-select" value={tienda ?? ""} onChange={(e) => setTienda(e.target.value || null)} disabled={ocupado}>
        {datos.tiendas.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>
  ) : null;

  const preguntaDeSalida = (
    <div className="fichaje-del-hub-confirma" role="group" aria-label={t("End shift", "Terminar turno")}>
      <p>{t("End your shift now?", "¿Terminar tu turno ahora?")}</p>
      <div className="fichaje-del-hub-fila">
        <button type="button" className="btn btn-danger" onClick={terminar} disabled={ocupado}>{t("Yes", "Sí")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirmar(false)} disabled={ocupado}>{t("No", "No")}</button>
      </div>
    </div>
  );

  const bloqueo = bloqueado ? createPortal(
    <div className="fichaje-del-hub-bloqueo" data-bloqueo-del-hub ref={overlayRef} role="alertdialog" aria-modal="true" aria-labelledby={`${idBloqueo}-titulo`}>
      <div className="fichaje-del-hub-bloqueo-tarjeta">
        <h2 id={`${idBloqueo}-titulo`}>{t("You are on a break", "Estás en tu almuerzo")}</h2>
        <p className="fichaje-del-hub-sub">{t(`since ${hora}`, `desde las ${hora}`)}</p>
        <p className="fichaje-del-hub-cronometro" aria-live="off">{formatoCronometro(transcurrido)}</p>
        <button type="button" ref={botonVolverRef} className="btn btn-green fichaje-del-hub-grande" onClick={volver} disabled={ocupado}>
          {t("Back from break", "Volver del almuerzo")}
        </button>
        {confirmar ? preguntaDeSalida : (
          <button type="button" className="btn btn-ghost fichaje-del-hub-grande" onClick={() => setConfirmar(true)} disabled={ocupado}>
            {t("End shift", "Terminar turno")}
          </button>
        )}
        {aviso && <p className={"fichaje-del-hub-aviso" + (aviso.error ? " error" : "")} role="status">{aviso.texto}</p>}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div className="fichaje-del-hub" ref={cajaRef} data-fichaje-del-hub-caja>
        {verPrompt && (
          <div className="fichaje-del-hub-tarjeta" role="dialog" aria-label={t("Clock in", "Fichar")}>
            <p className="fichaje-del-hub-saludo">{primerNombre ? `${saludo}, ${primerNombre}` : saludo}</p>
            <p className="fichaje-del-hub-pregunta">{t("Do you want to clock in?", "¿Quieres fichar?")}</p>
            {selectorDeTienda}
            <div className="fichaje-del-hub-fila">
              <button type="button" className="btn btn-green" onClick={() => void fichar()} disabled={ocupado || (multi && !tienda)}>
                {t("Clock in", "Fichar")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setPrompt(false)} disabled={ocupado}>
                {t("Not now", "Ahora no")}
              </button>
            </div>
          </div>
        )}
        {verMenu && (
          <div className="fichaje-del-hub-tarjeta" role="menu" aria-label={t("On the clock", "Fichado")}>
            <p className="fichaje-del-hub-saludo">{t("You are on the clock", "Estás fichado")}</p>
            <p className="fichaje-del-hub-sub">
              {t(`since ${hora}`, `desde las ${hora}`)} · {formatoTranscurrido(transcurrido)}
            </p>
            {confirmar ? preguntaDeSalida : (
              <>
                <button type="button" role="menuitem" className="btn btn-ghost fichaje-del-hub-grande" onClick={() => void empezarBreak()} disabled={ocupado}>
                  ☕ {t("Take a break", "Tomar un descanso")}
                </button>
                <button type="button" role="menuitem" className="btn btn-danger fichaje-del-hub-grande" onClick={() => setConfirmar(true)} disabled={ocupado}>
                  🏁 {t("End shift", "Terminar turno")}
                </button>
              </>
            )}
          </div>
        )}
        {aviso && !bloqueado && <div className={"toast" + (aviso.error ? " toast-error" : "")} role="status">{aviso.texto}</div>}
        <button
          type="button"
          className={"fichaje-del-hub-boton " + (estadoActual === "fuera" ? "fuera" : "en-turno")}
          onClick={alPulsarBoton}
          aria-label={etiquetaBoton}
          title={etiquetaBoton}
          aria-haspopup={estadoActual === "fuera" ? "dialog" : "menu"}
          aria-expanded={estadoActual === "fuera" ? verPrompt : verMenu}
          data-fichaje-del-hub
          data-estado={estadoActual}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </button>
      </div>
      {bloqueo}
    </>
  );
}
