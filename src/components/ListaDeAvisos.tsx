"use client";

import { usePrefs } from "@/lib/prefs";
import { mensajeDelAviso } from "@/lib/customers/avisos-de-solicitud";
import { accionDelAviso, type AppAviso, type AvisoUnificado } from "@/lib/notificaciones-todas";
import { ago, COLOR_DE_APP, colorDelAviso, etiquetaDeApp } from "@/lib/aviso-presentacion";

/**
 * Las entradas de la lista de avisos: el texto, el punto de color, la etiqueta de app y la tarjeta que se abre bajo un
 * aviso de otra app. La usan la campana (`CampanaDeAvisos`) y el centro de avisos (`CentroDeAvisos`), para que los dos
 * pinten y reaccionen igual. Lo que pasa al pulsar lo decide quien la monta (`onPick`).
 */
export function ListaDeAvisos({ visibles, mostrarApp, appActual, abierta, onPick }: {
  visibles: readonly AvisoUnificado[];
  /** Pone la etiqueta de la app en cada aviso (la vista «Todas»). */
  mostrarApp: boolean;
  appActual: AppAviso;
  /** La clave del aviso cuya tarjeta está abierta, si hay una. */
  abierta: string | null;
  onPick: (n: AvisoUnificado) => void;
}) {
  const { t, lang } = usePrefs();
  return (
    <div className="notif-list">
      {visibles.map((n) => {
        const texto = n.base ? mensajeDelAviso(n.base, lang) : (n.message ?? "");
        const dotColor = n.base ? colorDelAviso(n.base.kind) : "var(--accent)";
        const accion = accionDelAviso(n, appActual);
        const expandida = accion.tipo === "tarjeta" && abierta === n.key;
        return (
          <div key={n.key} className="notif-entrada">
            <button
              className={"notif-item" + (n.read ? "" : " unread")}
              onClick={() => onPick(n)}
              aria-expanded={accion.tipo === "tarjeta" ? expandida : undefined}
            >
              <span className="notif-dot" style={{ background: dotColor }} />
              <span className="notif-body">
                {mostrarApp && (
                  <span className="notif-app" style={{ color: COLOR_DE_APP[n.app] }}>{etiquetaDeApp(n.app, t)}</span>
                )}
                <span className="notif-msg">{texto}</span>
                <span className="notif-time">{ago(n.created_at, t)}</span>
              </span>
            </button>
            {expandida && accion.tipo === "tarjeta" && (
              <div className="notif-tarjeta">
                <div className="notif-time">{new Date(n.created_at).toLocaleString(lang === "es" ? "es" : "en")}</div>
                {accion.href && accion.app !== appActual && (
                  <a className="notif-abrir" href={accion.href}>
                    {t(`Open in ${etiquetaDeApp(accion.app, t)}`, `Abrir en ${etiquetaDeApp(accion.app, t)}`)}
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
