"use client";

import Link from "next/link";
import { useT } from "@/lib/timetracker/i18n";
import { shift } from "@/lib/timetracker/period";

/**
 * La cabecera de Nómina: lo que era la pestaña "Period" (D-190).
 *
 * Los datos llegan ya calculados del servidor (`payroll/page.tsx`, sobre la vista
 * `timetracker.period_hours`, la misma consulta de siempre): aquí no se suma nada, solo se
 * pinta. Sigue sin sumar fichaje y proyecto (D-102): son dos columnas, y a quien tiene las
 * dos se le avisa. La navegación por periodo es por URL (`?period=`), la única enlazable, y
 * es la fuente de la fecha para las dos secciones de abajo.
 *
 * D-NEXT: más grande y con las tarjetas renombradas, a petición del dueño con capturas. Lo
 * primero que se ve es el número; la tarjeta de fichaje se llama "Total en sitio" y la de
 * sesiones "Total remoto" (antes "Clock-in hours" / "Project hours"). Los números y su origen
 * no cambian: `fichaje` sigue siendo horas de fichaje y `proyecto` horas de sesiones. El
 * desglose pequeño de cada tarjeta es por TIPO DE TRABAJADOR (`worker_type`, D-190) y el
 * rótulo ahora lo dice, para que no parezca que contradice al título. Estilos en
 * `timetracker.css` (`.pay-*`) sobre las variables `--tt-*` del módulo: oscuro por defecto,
 * claro con data-theme="light"; nada de colores a pelo (D-187 pagó por no comprobarlo).
 */
export type Resumen = {
  start: string;
  error: string | null;
  personas: number;
  fichaje: { total: number; enSitio: number; remotos: number };
  proyecto: { total: number; enSitio: number; remotos: number };
  /** Nombres de quien tiene horas por las dos vías este periodo (`period_hours.revisar`). */
  aRevisar: string[];
  /** Nombres de quien no tiene tipo de trabajador puesto y se dedujo del periodo. */
  deducidos: string[];
};

const h = (n: number) => `${n.toFixed(2)} h`;

export function PayrollResumen({ r }: { r: Resumen }) {
  const t = useT();
  const nombres = (xs: string[]) => xs.join(", ");
  // Los títulos son totales POR VÍA (todo lo fichado; todo lo cronometrado), sea quien sea. Como
  // hay remotos que fichan y gente de sitio que cronometra, el desglose dice la vía Y el tipo de
  // trabajador; un título a secas prometería de más (D-044).
  // Las dos claves van literales en cada tarjeta, no por variable: la prueba de claves de D-187
  // lee el fuente buscando las llamadas con la clave entre comillas, y una clave pasada por
  // variable se le escaparía. (Y ojo con escribir esa forma en un comentario: también la lee.)
  const vars = (x: { enSitio: number; remotos: number }) => ({ a: h(x.enSitio), b: h(x.remotos) });

  return (
    <div className="card pay-card">
      <div className="pay-head">
        <h2 className="pay-title">{t("mgr.pay.title")}</h2>
        <nav className="pay-nav" aria-label={t("mgr.pay.title")}>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(r.start, -7)}`}>{t("mgr.pay.prev")}</Link>
          <span className="pay-range">{r.start} → {shift(r.start, 6)}</span>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(r.start, 7)}`}>{t("mgr.pay.next")}</Link>
        </nav>
      </div>

      {r.error && <p className="muted" style={{ marginTop: 12 }}>{t("mgr.pay.errRead", { msg: r.error })}</p>}

      {r.personas === 0 && !r.error ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.pay.nobody")}</p>
      ) : (
        <div className="pay-stats">
          <div className="pay-stat">
            <div className="pay-n">{h(r.fichaje.total)}</div>
            <div className="pay-l">{t("mgr.pay.totalOnSite")}</div>
            <div className="pay-sub">{t("mgr.pay.byTypePunched", vars(r.fichaje))}</div>
          </div>
          <div className="pay-stat">
            <div className="pay-n">{h(r.proyecto.total)}</div>
            <div className="pay-l">{t("mgr.pay.totalRemote")}</div>
            <div className="pay-sub">{t("mgr.pay.byTypeTimer", vars(r.proyecto))}</div>
          </div>
          <div className="pay-stat">
            <div className="pay-n">{r.personas}</div>
            <div className="pay-l">{t("mgr.pay.everyone")}</div>
            <div className="pay-sub">{t("mgr.pay.people", { n: r.personas })}</div>
          </div>
        </div>
      )}

      {r.aRevisar.length > 0 && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          {r.aRevisar.length === 1 ? t("mgr.pay.revisar1") : t("mgr.pay.revisarN", { n: r.aRevisar.length })}{" "}
          <strong>{t("mgr.pay.revisarNotAdded")}</strong> {t("mgr.pay.revisarWhy", { names: nombres(r.aRevisar) })}
        </div>
      )}

      {r.deducidos.length > 0 && (
        <div className="banner info" style={{ marginTop: 14 }}>
          {r.deducidos.length === 1 ? t("mgr.pay.guessed1") : t("mgr.pay.guessedN", { n: r.deducidos.length })}{" "}
          <strong>{nombres(r.deducidos)}</strong>. {t("mgr.pay.guessedFix")}{" "}
          <Link href="/timetracker/people">{t("mgr.pay.employees")}</Link>{t("mgr.pay.guessedTail")}
        </div>
      )}

      <p className="pay-note">{t("mgr.pay.note")}</p>
    </div>
  );
}
