"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IMPERSONACION_MINUTOS } from "@/lib/impersonation";
import { SwitchUserPanel } from "@/components/SwitchUserPanel";
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

type Estado = { como: string; inicio: number } | null;

export function ImpersonationBanner() {
  const [estado, setEstado] = useState<Estado>(null);
  const [volviendo, setVolviendo] = useState(false);
  const [quedan, setQuedan] = useState<number | null>(null);
  // «Cambiar a otro usuario» (D-NEXT): el dueño, «si estoy en otro usuario ya con el switch, que siga
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

  useEffect(() => {
    let vivo = true;
    fetch("/api/impersonate/state")
      .then((r) => r.json())
      .then((d: { como?: string; inicio?: number }) => {
        if (vivo && d?.como && typeof d.inicio === "number") setEstado({ como: d.como, inicio: d.inicio });
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
    window.location.href = "/";
  }, []);

  useEffect(() => {
    if (!estado) return;
    const tic = () => {
      const restan = estado.inicio + IMPERSONACION_MINUTOS * 60_000 - Date.now();
      setQuedan(Math.max(0, Math.ceil(restan / 60_000)));
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

  if (!estado) return null;

  return (
    <div
      ref={caja}
      role="alert"
      style={{
        position: "sticky", top: 0, zIndex: 9999,
        display: "flex", gap: 12, alignItems: "center", justifyContent: "center",
        flexWrap: "wrap", padding: "8px 16px",
        background: "var(--amber, #fbf1df)", color: "var(--ink, #152238)",
        borderBottom: "2px solid var(--red, #c0392b)",
      }}
    >
      <span className="small" style={{ fontWeight: 700 }}>
        Estás como {estado.como} · You are signed in as {estado.como}
      </span>
      {quedan !== null && (
        <span className="small muted">
          {quedan} min
        </span>
      )}
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={volviendo}
        onClick={() => void volver("manual")}
      >
        {volviendo ? "Volviendo…" : "Volver a mi cuenta / Back to my account"}
      </button>
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="btn btn-sm"
          disabled={volviendo}
          aria-expanded={saltando}
          onClick={() => { if (saltando) setSaltando(false); else void abrirSalto(); }}
        >
          ⇄ Cambiar a otro usuario / Switch to another user
        </button>
        {saltando && candidatos && (
          <SwitchUserPanel users={candidatos.users} tiendas={candidatos.stores} modo="saltar" onClose={() => setSaltando(false)} />
        )}
      </div>
    </div>
  );
}
