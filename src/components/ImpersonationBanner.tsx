"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { usePathname } from "next/navigation";
import { IMPERSONACION_MINUTOS } from "@/lib/impersonation";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
import { PrefsConIdioma } from "@/lib/prefs";
import { ConfirmProvider } from "@/lib/confirm";
import { botonDeVista, estaEnUnMarco, type BotonDeVista } from "@/lib/mobile-preview";
import { destinoDeLaApp } from "@/lib/boton-general";
import { idiomaDelAviso, traduce } from "@/lib/aviso-de-suplantacion";
import type { Idioma } from "@/lib/idioma";
import type { NamedLocation, Profile } from "@/lib/types";

/**
 * «Estás como Patricia Hernández — volver a mi cuenta» (D-243).
 *
 * Es la pieza que hace que esto sea una herramienta y no una trampa. Un admin dentro de la
 * sesión de otra persona **escribe como esa persona**: aprueba, ficha, cambia una orden. Si se
 * olvida de que no es él, el rastro de la app dirá que lo hizo ella. Por eso el banner no se
 * puede cerrar y está en todas las pantallas de las cinco apps, no solo en el hub.
 *
 * Va en el layout raíz, como `VersionStamp`, y pregunta al servidor **una vez** al montar. En
 * una sesión normal la respuesta es «no estás como nadie» y el componente no pinta nada; ese es
 * el caso de casi todas las cargas de página, así que no puede costar más que una petición.
 *
 * También es quien **devuelve al admin al cumplirse la hora**. Podría hacerlo el servidor en
 * cada navegación, pero desde aquí la vuelta es la buena —se restaura la cuenta del admin— y
 * desde el middleware lo único que se puede hacer sin JavaScript es cerrar y mandar al login.
 * Así que el camino amable vive aquí y el duro allí, y el de allí es el respaldo para la pestaña
 * que nadie está mirando.
 */

type Estado = { como: string; inicio: number; cambiaContrasena?: boolean; idioma: Idioma } | null;

/** La copia de pantalla del idioma de este equipo (`rtg_prefs`), para cuando el admin nunca eligió uno. */
function leeCopiaLocal(): string | null {
  try {
    return localStorage.getItem("rtg_prefs");
  } catch {
    return null;
  }
}

/** La ruta que tiene cargada el marco de la vista móvil, si esta página lo lleva y se deja leer. */
function rutaDelMarcoAbierto(): string | null {
  try {
    const l = document.querySelector<HTMLIFrameElement>("iframe.vista-movil-marco")?.contentWindow?.location;
    return l ? l.pathname + l.search : null;
  } catch {
    return null;
  }
}

/**
 * Se navega la pestaña de ARRIBA: desde dentro del marco es la de fuera, que es la que tiene que dejar de ser
 * la vista móvil; fuera de un marco, `window.top` es esta misma.
 */
function irArriba(destino: string) {
  try {
    (window.top ?? window).location.assign(destino);
  } catch {
    window.location.assign(destino);
  }
}

export function ImpersonationBanner() {
  const [estado, setEstado] = useState<Estado>(null);
  const [volviendo, setVolviendo] = useState(false);
  // «Cambiar a otro usuario» (D-307): el dueño, «si estoy en otro usuario ya con el switch, que siga
  // la opción para seguir switcheando». Los candidatos se piden SOLO al pulsar: una carga normal sigue
  // costando la petición de siempre. Aquí no hay `DataProvider` —el banner va en el layout raíz— y
  // por eso el panel recibe la lista por props, ya filtrada por el servidor con la misma regla que la
  // ruta de saltar.
  const [saltando, setSaltando] = useState(false);
  const [candidatos, setCandidatos] = useState<{ users: Profile[]; stores: NamedLocation[] } | null>(null);
  const abrirSalto = useCallback(async () => {
    setSaltando(true);
    if (candidatos) return;
    try {
      const r = await fetch("/api/impersonate/switch/candidates");
      if (!r.ok) { setSaltando(false); return; }   // apagada, o una cookie que no cuadra: sin lista
      setCandidatos((await r.json()) as { users: Profile[]; stores: NamedLocation[] });
    } catch { setSaltando(false); }
  }, [candidatos]);

  const caja = useRef<HTMLDivElement | null>(null);
  // ¿Esta página está dentro del marco de la vista móvil? (D-516) Se mira al montar: en el servidor no hay
  // ventana, y el aviso no se pinta hasta que responde el servidor, así que no hay nada que hidratar distinto.
  const [enMarco, setEnMarco] = useState(false);
  // La ruta, para el texto del botón: el aviso vive en el layout raíz y NO se vuelve a montar al navegar.
  const pathname = usePathname();

  useEffect(() => {
    let vivo = true;
    setEnMarco(estaEnUnMarco(window));
    fetch("/api/impersonate/state")
      .then((r) => r.json())
      .then((d: { como?: string; inicio?: number; cambiaContrasena?: boolean; idioma?: unknown }) => {
        if (vivo && d?.como && typeof d.inicio === "number") {
          setEstado({
            como: d.como, inicio: d.inicio, cambiaContrasena: d.cambiaContrasena === true,
            idioma: idiomaDelAviso({ delAdmin: d.idioma, copiaLocal: leeCopiaLocal() }),
          });
        }
      })
      .catch(() => { /* sin respuesta no se pinta nada: no hay nada que prometer */ });
    return () => { vivo = false; };
  }, []);

  const volver = useCallback(async (motivo: "manual" | "expired") => {
    setVolviendo(true);
    try {
      await fetch("/api/impersonate/return", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
    } catch { /* da igual: se recarga y el servidor decide con lo que haya */ }
    // Recarga completa y no `router.refresh()`: cambia la identidad de la sesión entera, y todo
    // lo que hay en memoria —el proveedor de datos, las listas, los permisos— es de la otra
    // persona. Volver «en caliente» dejaría media pantalla con datos de quien ya no eres.
    // A la portada de la app en la que se está (D-NEXT, 2026-10-21): Entregas a Entregas, RR. HH. a RR. HH., el hub al
    // hub. El dueño: «pero no que siempre esté cayendo el delivery sub».
    window.location.href = destinoDeLaApp(window.location.pathname);
  }, []);

  useEffect(() => {
    if (!estado) return;
    const tic = () => {
      const restan = estado.inicio + IMPERSONACION_MINUTOS * 60_000 - Date.now();
      if (restan <= 0 && !volviendo) void volver("expired");
    };
    tic();
    const id = setInterval(tic, 30_000);
    return () => clearInterval(id);
  }, [estado, volviendo, volver]);

  // La altura del banner, publicada para quien no está en el flujo. Las barras de Entregas,
  // RR. HH. y Time Tracker no la necesitan: el banner va delante de ellas en el documento y las
  // empuja. El ERP sí, porque su barra lateral es `fixed` contra la ventana y empieza en el
  // borde de arriba, donde ahora está el banner — sin esto le taparía el logo y el botón de
  // plegarla, que es la única forma de recuperarla.
  //
  // Se mide en vez de escribirse: el banner cambia de alto al partirse en dos líneas en un
  // móvil, y un número copiado en el CSS habría quedado corto justo ahí.
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const raiz = document.documentElement;
    const publica = () => raiz.style.setProperty("--banner-impersonacion", `${el.offsetHeight}px`);
    publica();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(publica) : null;
    ro?.observe(el);
    // Al desmontar se BORRA, no se pone a cero: fuera de una impersonación la propiedad no
    // existe y el `var(--banner-impersonacion, 0px)` del CSS usa su respaldo.
    return () => { ro?.disconnect(); raiz.style.removeProperty("--banner-impersonacion"); };
  }, [estado]);

  // Lo que hace el botón se decide al pulsar, con la ruta de ese momento (y la del marco, si esta es la página
  // de la vista móvil). El texto, con la ruta de ahora: dentro del marco o en la vista móvil, «escritorio».
  const cambiarDeVista = useCallback(() => {
    const b = botonDeVista({
      enMarco: estaEnUnMarco(window),
      pathname: window.location.pathname,
      search: window.location.search,
      rutaDelMarco: rutaDelMarcoAbierto(),
    });
    irArriba(b.destino);
  }, []);

  if (!estado) return null;

  return (
    <AvisoDeSuplantacion
      cajaRef={caja}
      como={estado.como}
      idioma={estado.idioma}
      cambiaContrasena={estado.cambiaContrasena === true}
      volviendo={volviendo}
      onVolver={() => void volver("manual")}
      saltando={saltando}
      onSalto={() => { if (saltando) setSaltando(false); else void abrirSalto(); }}
      vista={botonDeVista({ enMarco, pathname: pathname || "/" }).vista}
      onVista={cambiarDeVista}
      panel={
        // El banner vive en el layout raíz, FUERA de `PrefsProvider` y sin `ConfirmProvider` (a propósito:
        // no depende de nadie). El panel sí usa `usePrefs` y `useConfirm`, y sin ellos encima revienta al
        // montarse: es el «Something went wrong» que vio el dueño al pulsar «Switch to another user» (D-321).
        // Se le ponen aquí, solo alrededor del panel. D-516: con el idioma PUESTO, el del aviso; un
        // `PrefsProvider` cargaría el de la persona en la que se entró.
        saltando && candidatos && (
          <PrefsConIdioma lang={estado.idioma}>
            <ConfirmProvider>
              <SwitchUserPanel users={candidatos.users} tiendas={candidatos.stores} modo="saltar" onClose={() => setSaltando(false)} destino={destinoDeLaApp(pathname)} />
            </ConfirmProvider>
          </PrefsConIdioma>
        )
      }
    />
  );
}

/**
 * Lo que se ve del aviso, sin estado: el banner de arriba decide y esto pinta. Separado para poder pintarlo en
 * una prueba en los dos idiomas y con los dos botones de vista (D-516).
 */
export function AvisoDeSuplantacion(p: {
  cajaRef?: Ref<HTMLDivElement>;
  como: string;
  idioma: Idioma;
  cambiaContrasena: boolean;
  volviendo: boolean;
  onVolver: () => void;
  saltando: boolean;
  onSalto: () => void;
  vista: BotonDeVista["vista"];
  onVista: () => void;
  panel?: ReactNode;
}) {
  const t = traduce(p.idioma);
  const nombreVista = p.vista === "escritorio" ? t("Desktop view", "Vista de escritorio") : t("Mobile view", "Vista móvil");
  return (
    <div
      ref={p.cajaRef}
      role="alert"
      style={{
        position: "sticky", top: 0, zIndex: 9999,
        display: "flex", gap: 10, alignItems: "center", justifyContent: "center",
        flexWrap: "wrap", padding: "4px 12px",
        background: "var(--amber, #fbf1df)", color: "var(--ink, #152238)",
        borderBottom: "2px solid var(--red, #c0392b)",
      }}
    >
      {/* D-483: una sola línea corta. El dueño, 2026-10-06: «lo único que salga ahí es, ok, estás login como Robert y ya.
          Pero no quiero ese timeout y esa cosa porque quita mucho espacio». Los minutos ya no se pintan; la vuelta
          automática a la hora sigue (abajo y en el middleware), que es la red de seguridad de D-243. */}
      <span className="small" style={{ fontWeight: 700 }}>
        {t("👤 Signed in as", "👤 Estás como")} {p.como}
      </span>
      {/* D-486: esa persona tiene una contraseña temporal. A ella la app le obliga a cambiarla al
          entrar; al admin no, porque no es suya. Se le avisa, corto (D-483: el aviso, en una línea). */}
      {p.cambiaContrasena && (
        <span className="small" data-aviso="cambio-contrasena">
          {t("🔑 Temporary password: they change it when they sign in, you are not asked to",
             "🔑 Contraseña temporal: la cambia ella al entrar, a ti no se te pide")}
        </span>
      )}
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={p.volviendo}
        onClick={p.onVolver}
      >
        {p.volviendo ? t("Going back…", "Volviendo…") : t("↩ Back to my account", "↩ Volver a mi cuenta")}
      </button>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={p.volviendo}
          aria-expanded={p.saltando}
          onClick={p.onSalto}
        >
          {t("⇄ Switch user", "⇄ Cambiar usuario")}
        </button>
        {p.panel}
      </div>
      {/* D-516. El dueño, 2026-10-11, con la vista móvil abierta: «EN ESE MISMO AMARILLO QUIERO QUE ESTE PARA
          CMABIAR DE DESKTOP VIEW A MOBILE VIEW». Fuera del marco abre esta pantalla en la vista móvil; dentro, la
          saca a tamaño normal en la pestaña de arriba. Corto, como los otros dos (D-483): en un ancho de teléfono
          —el marco lo es— solo el icono (`.aviso-vista-texto`, globals.css), y el nombre en `aria-label` y `title`. */}
      <button
        type="button"
        className="btn btn-sm"
        data-cambia-vista={p.vista}
        disabled={p.volviendo}
        onClick={p.onVista}
        aria-label={nombreVista}
        title={p.vista === "escritorio"
          ? t("Desktop view: take this screen out of the phone frame, at full size",
              "Vista de escritorio: sacar esta pantalla del marco de teléfono, a tamaño normal")
          : t("Mobile view: see this screen as it looks on a phone", "Vista móvil: ver esta pantalla como se ve en un teléfono")}
      >
        <span aria-hidden="true">{p.vista === "escritorio" ? "🖥️" : "📱"}</span>
        <span className="aviso-vista-texto" aria-hidden="true"> {nombreVista}</span>
      </button>
    </div>
  );
}
