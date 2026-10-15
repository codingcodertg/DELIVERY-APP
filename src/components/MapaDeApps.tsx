"use client";

import Link from "next/link";
import {
  CASILLAS, FLECHAS, PANELES, casilla, celdaDe, colocacion, estadoDeCasilla, otrasApps, secuenciaMovil, trazoDe,
  type Alcance, type Casilla, type Flecha, type PanelKey,
} from "@/lib/mapa-de-apps";

type T = (en: string, es: string) => string;

/**
 * El mapa de apps del hub (D-554), al estilo de la «Home Page» de QuickBooks. Solo pinta: qué casilla se abre, cuál va
 * con candado, cuál es «Próximamente» y cómo se traza cada flecha lo decide `src/lib/mapa-de-apps.ts`.
 *
 * Dos dibujos del mismo dato: la rejilla con flechas en el escritorio, y en el teléfono una lista por panel con chevrones
 * hacia abajo (`secuenciaMovil`). El CSS enseña uno u otro; nunca hay desplazamiento horizontal.
 */
export function MapaDeApps({ alcance, lang, t, sinLeerDe }: {
  alcance: Alcance;
  lang: string;
  t: T;
  /** Mensajes de ayuda sin leer de una herramienta (D-311), para su número en la casilla. */
  sinLeerDe: (herramienta: string) => number;
}) {
  const nombre = (c: Casilla) => (lang === "es" ? c.label_es : c.label_en);
  const conectadas = FLECHAS.filter((f) => trazoDe(f) === "conectada").length;
  const otras = otrasApps(alcance);
  // Lo que a una conexión hecha aún le falta (D-NEXT: la migración 175) se dice en su etiqueta, no se calla.
  const estadoFlecha = (f: Flecha) => (trazoDe(f) === "conectada"
    ? t("connected", "conectada") + (f.pendiente ? ` (${t("pending", "pendiente")}: ${f.pendiente})` : "")
    : t("not connected yet", "por conectar"));
  const etiquetaFlecha = (f: Flecha) => `${nombre(casilla(f.de))} → ${nombre(casilla(f.a))}: ${estadoFlecha(f)}`;

  const pieza = (c: Casilla) => {
    const e = estadoDeCasilla(c, alcance);
    if (e.estado === "abierta") {
      const n = e.herramienta ? sinLeerDe(e.herramienta) : 0;
      return (
        <Link href={e.href} className="mapa-casilla" data-mapa-casilla={c.key} data-estado="abierta">
          <span className="mapa-icono" aria-hidden>{c.emoji}</span>
          <span className="mapa-nombre">
            {nombre(c)}
            {n > 0 && <span className="hub-tool-badge">{n}</span>}
          </span>
        </Link>
      );
    }
    const bloqueada = e.estado === "sin-acceso";
    return (
      <div
        className={`mapa-casilla ${bloqueada ? "is-bloqueada" : "is-proximamente"}`}
        data-mapa-casilla={c.key}
        data-estado={e.estado}
        aria-disabled="true"
        title={bloqueada
          ? e.estado === "sin-acceso" && e.motivo === "nivel-erp"
            ? t("This ERP screen needs the ERP manager or admin level. Ask an admin.", "Esta pantalla del ERP pide el nivel manager o admin del ERP. Pídeselo a un administrador.")
            : t("You don't have access to this app. Ask an admin.", "No tienes acceso a esta app. Pídeselo a un administrador.")
          : t("Coming soon — this app isn't built yet.", "Próximamente — esta app aún no se ha creado.")}
      >
        <span className="mapa-icono" aria-hidden>{c.emoji}</span>
        <span className="mapa-nombre">{nombre(c)}</span>
        <span className="mapa-aviso">{bloqueada ? `🔒 ${t("No access", "Sin acceso")}` : t("Coming soon", "Próximamente")}</span>
      </div>
    );
  };

  const rejilla = (panel: PanelKey) => {
    const casillas = CASILLAS.filter((c) => c.panel === panel);
    if (panel === "employees") {
      return <div className="mapa-fila-libre">{casillas.map((c) => <div key={c.key} className="mapa-celda">{pieza(c)}</div>)}</div>;
    }
    return (
      <div className="mapa-rejilla">
        {casillas.map((c) => <div key={c.key} className="mapa-celda" style={celdaDe(c)}>{pieza(c)}</div>)}
        {FLECHAS.map((f) => ({ f, p: colocacion(f) })).filter(({ p }) => p.panel === panel).map(({ f, p }) => (
          <span
            key={`${f.de}>${f.a}`}
            className={`mapa-flecha is-${p.direccion} is-${trazoDe(f)}`}
            style={{ gridRow: p.gridRow, gridColumn: p.gridColumn }}
            role="img"
            aria-label={etiquetaFlecha(f)}
            title={etiquetaFlecha(f)}
            data-mapa-flecha={`${f.de}>${f.a}`}
          />
        ))}
      </div>
    );
  };

  const listaMovil = (panel: PanelKey) => (
    <div className="mapa-lista">
      {secuenciaMovil(panel).map(({ casilla: c, siguiente, otras: aparte }) => (
        <div key={c.key} className="mapa-paso">
          {pieza(c)}
          {aparte.map((f) => (
            <span key={f.a} className={`mapa-aparte is-${trazoDe(f)}`} title={etiquetaFlecha(f)}>
              → {nombre(casilla(f.a))} · {estadoFlecha(f)}
            </span>
          ))}
          {siguiente && (
            <span className={`mapa-chevron is-${trazoDe(siguiente)}`} role="img" aria-label={etiquetaFlecha(siguiente)} title={etiquetaFlecha(siguiente)} />
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="mapa-apps" data-mapa-apps>
      <div className="mapa-leyenda">
        <span><span className="mapa-muestra is-conectada" aria-hidden /> {t("connected", "conectada")}</span>
        <span><span className="mapa-muestra is-por-conectar" aria-hidden /> {t("not connected yet", "por conectar")}</span>
        <span><span className="mapa-muestra-gris" aria-hidden /> {t("gray = coming soon", "gris = próximamente")}</span>
        <span className="mapa-cuenta" data-mapa-conectadas={conectadas}>
          {t(`${conectadas} of ${FLECHAS.length} connections built`, `${conectadas} de ${FLECHAS.length} conexiones hechas`)}
        </span>
      </div>
      {PANELES.map((p) => (
        <section key={p.key} className="mapa-panel" data-mapa-panel={p.key}>
          <h2 className="mapa-panel-titulo">{lang === "es" ? p.label_es : p.label_en}</h2>
          <div className="mapa-escritorio">{rejilla(p.key)}</div>
          <div className="mapa-movil">{listaMovil(p.key)}</div>
        </section>
      ))}
      {otras.length > 0 && (
        <div className="mapa-otras" data-mapa-otras>
          <div className="hub-tools-label">{t("Other apps", "Otras apps")}</div>
          <div className="mapa-otras-fila">
            {otras.map((o) => (
              <Link key={o.llave} href={o.href} className="mapa-otra" data-mapa-otra={o.key}>
                <span aria-hidden>{o.emoji}</span> {lang === "es" ? o.label_es : o.label_en}
                {sinLeerDe(o.key) > 0 && <span className="hub-tool-badge">{sinLeerDe(o.key)}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
