"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePrefs } from "@/lib/prefs";
import type { AppAviso, AvisoUnificado } from "@/lib/notificaciones-todas";
import { etiquetaDeApp } from "@/lib/aviso-presentacion";
import {
  avisosDelCentro, etiquetaDelTipo, gruposDelCentro, SELECCION_INICIAL, type EtiquetaBilingue, type SeleccionDelCentro,
} from "@/lib/centro-de-avisos";
import { ListaDeAvisos } from "@/components/ListaDeAvisos";

/** Las cuentas de un grupo: el total, y el número rojo con los sin leer. */
function Cifras({ total, sinLeer }: { total: number; sinLeer: number }) {
  return (
    <span className="notif-centro-cifras">
      <span className="notif-centro-cifra">{total}</span>
      {sinLeer > 0 && <span className="notif-tab-cnt fuerte">{sinLeer}</span>}
    </span>
  );
}

/**
 * El centro de avisos: una pantalla completa sobre la pantalla actual (no navega a otro sitio), con los avisos agrupados
 * por app y por tipo, con sus cuentas. Solo deja VER el ruido por grupos; todavía no apaga nada (reunión del 23 nov 2026).
 *
 * Escritorio: columna de grupos a la izquierda, lista a la derecha. Teléfono: una columna; los grupos son una fila de
 * chips que se desplaza en horizontal (las apps, y luego los tipos de la app elegida). Se cierra con ✕ o con Esc, y la
 * campana recupera el foco al cerrar. Lo que hace un aviso al pulsarlo lo decide quien lo monta (`onPick`), igual que en
 * la campana.
 */
export function CentroDeAvisos({ todos, appActual, abierta, onPick, onMarcar, onCerrar }: {
  /** Todos los avisos que la campana tiene (Entregas, Clientes y RRHH), ya unidos y ordenados. */
  todos: readonly AvisoUnificado[];
  appActual: AppAviso;
  /** La clave del aviso con la tarjeta abierta (la misma que en la campana). */
  abierta: string | null;
  onPick: (n: AvisoUnificado) => void;
  /** Marca como leídos los avisos listados (los que ya lo están se ignoran). */
  onMarcar: (items: AvisoUnificado[]) => void;
  onCerrar: () => void;
}) {
  const { t } = usePrefs();
  const [sel, setSel] = useState<SeleccionDelCentro>(SELECCION_INICIAL);
  const [soloSinLeer, setSoloSinLeer] = useState(false);
  const dialogoRef = useRef<HTMLDivElement>(null);
  // Esc y el efecto de abajo usan siempre la última versión de `onCerrar`, sin reengancharse en cada render.
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  const grupos = useMemo(() => gruposDelCentro(todos), [todos]);
  const delGrupo = useMemo(() => avisosDelCentro(todos, sel, false), [todos, sel]);
  const visibles = useMemo(() => avisosDelCentro(todos, sel, soloSinLeer), [todos, sel, soloSinLeer]);
  const sinLeerDelGrupo = delGrupo.filter((n) => !n.read).length;
  const sinLeerVisibles = visibles.filter((n) => !n.read).length;

  // Al abrir: el cuerpo de la página no se desplaza por detrás, el foco entra al diálogo y Esc lo cierra.
  useEffect(() => {
    const scrollAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogoRef.current?.focus();
    const alPulsar = (e: KeyboardEvent) => { if (e.key === "Escape") cerrarRef.current(); };
    window.addEventListener("keydown", alPulsar);
    return () => {
      document.body.style.overflow = scrollAntes;
      window.removeEventListener("keydown", alPulsar);
    };
  }, []);

  const bilingue = (e: EtiquetaBilingue) => t(e.en, e.es);
  const nombre = sel.app === "todas" ? t("All", "Todas")
    : sel.tipo === null ? etiquetaDeApp(sel.app, t)
    : `${etiquetaDeApp(sel.app, t)} · ${bilingue(etiquetaDelTipo(sel.tipo))}`;

  return createPortal(
    <div
      ref={dialogoRef}
      className="notif-centro"
      role="dialog"
      aria-modal="true"
      aria-label={t("Notification center", "Centro de notificaciones")}
      tabIndex={-1}
    >
      <div className="notif-centro-barra">
        <div className="notif-centro-cabeza">
          <b>{nombre}</b>
          <span className="notif-time">
            {t(`${delGrupo.length} total · ${sinLeerDelGrupo} unread`, `${delGrupo.length} en total · ${sinLeerDelGrupo} sin leer`)}
          </span>
        </div>
        <button type="button" className="notif-clear btn-cerrar-panel" onClick={() => onCerrar()}
          aria-label={t("Close", "Cerrar")} title={t("Close", "Cerrar")}>✕</button>
      </div>

      <div className="notif-centro-cuerpo">
        <nav className="notif-centro-grupos" aria-label={t("Groups", "Grupos")}>
          <button type="button" data-grupo="todas" aria-pressed={sel.app === "todas"}
            className={"notif-centro-grupo" + (sel.app === "todas" ? " on" : "")}
            onClick={() => setSel({ app: "todas", tipo: null })}>
            <span className="notif-centro-nombre">{t("All", "Todas")}</span>
            <Cifras total={grupos.total} sinLeer={grupos.sinLeer} />
          </button>
          {grupos.apps.map((g) => (
            <Fragment key={g.app}>
              <button type="button" data-grupo={g.app} data-nivel="app" aria-pressed={sel.app === g.app && sel.tipo === null}
                className={"notif-centro-grupo" + (sel.app === g.app && sel.tipo === null ? " on" : "")}
                onClick={() => setSel({ app: g.app, tipo: null })}>
                <span className="notif-centro-nombre">{etiquetaDeApp(g.app, t)}</span>
                <Cifras total={g.total} sinLeer={g.sinLeer} />
              </button>
              {g.tipos.map((tp) => (
                <button type="button" key={tp.tipo} data-grupo={g.app} data-nivel="tipo"
                  data-activa={sel.app === g.app ? "si" : "no"} aria-pressed={sel.app === g.app && sel.tipo === tp.tipo}
                  className={"notif-centro-grupo notif-centro-tipo" + (sel.app === g.app && sel.tipo === tp.tipo ? " on" : "")}
                  onClick={() => setSel({ app: g.app, tipo: tp.tipo })}>
                  <span className="notif-centro-nombre">{bilingue(etiquetaDelTipo(tp.tipo))}</span>
                  <Cifras total={tp.total} sinLeer={tp.sinLeer} />
                </button>
              ))}
            </Fragment>
          ))}
        </nav>

        <section className="notif-centro-lista">
          <div className="notif-centro-controles">
            <button type="button" className={"notif-chip" + (soloSinLeer ? " on" : "")} aria-pressed={soloSinLeer}
              onClick={() => setSoloSinLeer((v) => !v)}>
              {t("Unread only", "Solo sin leer")}
            </button>
            <button type="button" className="notif-clear" disabled={sinLeerVisibles === 0}
              onClick={() => onMarcar(visibles)}>
              {t("Mark these as read", "Marcar estas como leídas")}
            </button>
          </div>

          <div className="notif-centro-listado">
            {visibles.length === 0 ? (
              <div className="notif-empty">{t("You're all caught up 🎉", "Estás al día 🎉")}</div>
            ) : (
              <ListaDeAvisos visibles={visibles} mostrarApp={sel.app === "todas"} appActual={appActual}
                abierta={abierta} onPick={onPick} />
            )}
          </div>

          <div className="notif-centro-pie">
            {t(
              "Loaded: the last 50 Deliveries and Customers notifications, and the last 60 HR ones.",
              "Se cargan los últimos 50 avisos de Entregas y Clientes, y los últimos 60 de RRHH.",
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
