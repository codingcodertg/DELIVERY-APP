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

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="between">
        <h2 style={{ margin: 0 }}>{t("mgr.pay.title")}</h2>
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(r.start, -7)}`}>{t("mgr.pay.prev")}</Link>
          <span className="chip">{r.start} → {shift(r.start, 6)}</span>
          <Link className="btn btn-ghost btn-sm" href={`/timetracker/payroll?period=${shift(r.start, 7)}`}>{t("mgr.pay.next")}</Link>
        </div>
      </div>

      {r.error && <p className="muted" style={{ marginTop: 12 }}>{t("mgr.pay.errRead", { msg: r.error })}</p>}

      {r.personas === 0 && !r.error ? (
        <p className="muted" style={{ marginTop: 12 }}>{t("mgr.pay.nobody")}</p>
      ) : (
        <div className="grid g3" style={{ marginTop: 14 }}>
          <div className="stat">
            <div className="n">{h(r.fichaje.total)}</div>
            <div className="l">{t("mgr.pay.clockHours")}</div>
            <div className="small muted">{t("mgr.pay.onSite")} {h(r.fichaje.enSitio)} · {t("mgr.pay.remote")} {h(r.fichaje.remotos)}</div>
          </div>
          <div className="stat">
            <div className="n">{h(r.proyecto.total)}</div>
            <div className="l">{t("mgr.pay.projectHours")}</div>
            <div className="small muted">{t("mgr.pay.onSite")} {h(r.proyecto.enSitio)} · {t("mgr.pay.remote")} {h(r.proyecto.remotos)}</div>
          </div>
          <div className="stat">
            <div className="n">{r.personas}</div>
            <div className="l">{t("mgr.pay.everyone")}</div>
            <div className="small muted">{t("mgr.pay.people", { n: r.personas })}</div>
          </div>
        </div>
      )}

      {r.aRevisar.length > 0 && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          {r.aRevisar.length === 1 ? t("mgr.pay.revisar1") : t("mgr.pay.revisarN", { n: r.aRevisar.length })}{" "}
          <strong>{t("mgr.pay.revisarNotAdded")}</strong> {t("mgr.pay.revisarWhy", { names: nombres(r.aRevisar) })}
        </div>
      )}

      {r.deducidos.length > 0 && (
        <div className="banner info" style={{ marginTop: 12 }}>
          {r.deducidos.length === 1 ? t("mgr.pay.guessed1") : t("mgr.pay.guessedN", { n: r.deducidos.length })}{" "}
          <strong>{nombres(r.deducidos)}</strong>. {t("mgr.pay.guessedFix")}{" "}
          <Link href="/timetracker/people">{t("mgr.pay.employees")}</Link>{t("mgr.pay.guessedTail")}
        </div>
      )}

      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>{t("mgr.pay.note")}</p>
    </div>
  );
}
