"use client";

import { usePrefs } from "@/lib/prefs";
import { EMPRESA, RECORDATORIO_EN, RECORDATORIO_ES, filasDeHoja, tiendasDeHoja } from "@/lib/almacen-ops/etapas";
import { etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { repartoDeReporte } from "@/lib/almacen-ops/perdida";
import type { Reporte } from "@/lib/almacen-ops/datos";
import type { Contexto } from "./Operaciones";
import { SelectorDeColumnasDeHoja, TablaDeHoja, useColumnasDeHoja } from "./ColumnasDeHoja";
import "./reportes/hoja-de-aprobacion/hoja.css";
import { CerrarX } from "./CerrarX";

/**
 * Hoja de aprobación imprimible, EN LA APP (dueño, 10 nov): antes «Imprimir» abría otra página (`/…/hoja-de-aprobacion`),
 * que se sentía lenta. Ahora es un diálogo: se arma la hoja aquí y el botón Imprimir llama a `window.print()`. Las dos
 * firmas quedan como líneas en blanco (se firman en papel, o se usa el grupo digital para firmar en la app).
 */
export function HojaImprimible({ reportes, ctx, onCerrar }: { reportes: Reporte[]; ctx: Contexto; onCerrar: () => void }) {
  const { t, lang } = usePrefs();
  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "";
  const cols = useColumnasDeHoja(ctx.yo.id);
  const filas = filasDeHoja(reportes, nombre, (m) => etiquetaDeOpcion("scrap", "reason", m, lang) || (m ?? ""), (r) => repartoDeReporte(r).damaged);
  return (
    <div className="overlay" onClick={onCerrar}>
      <div className="modal ops-hoja-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-hoja-imprimible={reportes.length}>
        <CerrarX onCerrar={onCerrar} />
        <div className="hoja-barra no-imprimir">
          {/* Dueño, 11 nov: Imprimir y Cerrar arriba a la derecha, Cerrar al final. */}
          <SelectorDeColumnasDeHoja ocultas={cols.ocultas} alterna={cols.alterna} lang={lang} t={t} />
          <span className="hoja-barra-acciones">
            <button type="button" className="btn btn-primary" onClick={() => window.print()} data-accion="imprimir-hoja-modal">🖨 {t("Print", "Imprimir")}</button>
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>✕ {t("Close", "Cerrar")}</button>
          </span>
        </div>
        <article className="hoja-aprobacion">
          <header className="hoja-cabecera">
            <div>
              <h1>{EMPRESA}</h1>
              <h2>{t("Scrap approval sheet", "Hoja de aprobación de merma")}</h2>
            </div>
            <dl className="hoja-datos">
              <dt>{t("Store", "Tienda")}</dt><dd data-hoja-tienda>{tiendasDeHoja(filas)}</dd>
              <dt>{t("Reports", "Reportes")}</dt><dd>{filas.length}</dd>
            </dl>
          </header>
          <p className="hoja-recordatorio" data-recordatorio>
            <strong>{RECORDATORIO_ES}</strong>
            <span lang="en">{RECORDATORIO_EN}</span>
          </p>
          <TablaDeHoja filas={filas} ve={cols.ve} ocultas={cols.ocultas} lang={lang} t={t} vacio={t("No reports.", "No hay reportes.")} />
          {filas.some((f) => f.producto.endsWith(" *")) && <p className="hoja-nota">* {t("Product not in the catalog (name as written).", "Producto fuera del catálogo (nombre tal como se escribió).")}</p>}
          <section className="hoja-firmas">
            <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Warehouse supervisor", "Supervisor de almacén")}</span></div>
            <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Manager (approval)", "Gerente (autorización)")}</span></div>
            <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Date", "Fecha")}</span></div>
          </section>
        </article>
      </div>
    </div>
  );
}
