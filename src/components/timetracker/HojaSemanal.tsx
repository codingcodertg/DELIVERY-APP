"use client";

import { hmm, type FilaDeLaHoja, type HojaDeLaSemana } from "@/lib/clockin/hoja-semanal";
import { entryMinutes } from "@/lib/clockin/payroll";
import type { DiaDeTurnos } from "@/lib/clockin/turnos-por-dia";
import { getLang, useT } from "@/lib/timetracker/i18n";
import { APP_SETTINGS } from "@/lib/timetracker/helpers";

/**
 * La hoja semanal de horas, como la del Excel de la empresa (2026-11-24): un bloque por persona y semana,
 * una fila por día, el turno partido en INICIO DEL DÍA / COMIDA / FIN DEL DÍA. Los números vienen ya
 * calculados por `hojaDeLaSemana` (la misma aritmética que la tabla de Nómina); aquí solo se pintan.
 */
export type BloqueDeHoja = {
  id: string;
  nombre: string;
  /** Rótulo de la semana («Semana 27-Nov – 3-Dic») cuando el periodo tiene más de una; `null` si es una sola. */
  etiquetaSemana: string | null;
  semana: readonly string[];
  hoja: HojaDeLaSemana;
  /** Los días de la persona (`turnosPorDia`), para enseñar cada tramo en la marca «+N». */
  dias: readonly DiaDeTurnos[];
};

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone }) : "";

/** `28-Nov` y `FRIDAY` (en mayúsculas), y si es domingo. */
function partesDelDia(dia: string, lang: "en" | "es") {
  const [y, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d, 12));
  const loc = lang === "es" ? "es-MX" : "en-US";
  const mes = fecha.toLocaleDateString(loc, { month: "short", timeZone: "UTC" }).replace(".", "");
  return {
    fecha: `${d}-${mes}`,
    nombreDia: fecha.toLocaleDateString(loc, { weekday: "long", timeZone: "UTC" }).toLocaleUpperCase(loc),
    domingo: fecha.getUTCDay() === 0,
  };
}

export function HojaSemanal({ bloques }: { bloques: BloqueDeHoja[] }) {
  const t = useT();
  const lang = getLang();

  return (
    <div>
      {bloques.map((b) => {
        const sinNada = b.hoja.filas.every((f) => f.sinFichaje);
        return (
          <div key={`${b.id}-${b.semana[0]}`} style={{ marginTop: 10 }}>
            {b.etiquetaSemana && <div className="small muted">{b.etiquetaSemana}</div>}
            <div className="tt-hoja-caja">
              <table className="tt-hoja" data-hoja-de={b.id} data-sobre={String(b.hoja.sobre)}>
                <thead>
                  <tr>
                    <th colSpan={2} className="tt-hoja-nombre">{b.nombre}</th>
                    <th colSpan={3}>{t("hoja.startOfDay")}</th>
                    <th colSpan={2} className="tt-hoja-grupo">{t("hoja.lunch")}</th>
                    <th colSpan={2}>{t("hoja.endOfDay")}</th>
                    <th></th>
                  </tr>
                  <tr>
                    <th>{t("hoja.date")}</th>
                    <th>{t("hoja.day")}</th>
                    <th>{t("hoja.in")}</th>
                    <th>{t("hoja.out")}</th>
                    <th>{t("hoja.workTime")}</th>
                    <th>{t("hoja.in")}</th>
                    <th>{t("hoja.goneTime")}</th>
                    <th>{t("hoja.out")}</th>
                    <th>{t("hoja.workTime")}</th>
                    <th>{t("hoja.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {b.hoja.filas.map((f) => (
                    <FilaHoja key={f.dia} fila={f} dias={b.dias} lang={lang} t={t} />
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}></td>
                    <td colSpan={2} className={b.hoja.sobre ? "tt-hoja-sobre" : "tt-hoja-grupo"}>
                      {b.hoja.sobre ? t("hoja.over") : t("hoja.atOrBelow")}
                    </td>
                    <td>{t("hoja.totHrs")}</td>
                    <td className="tt-hoja-total">{hmm(b.hoja.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {sinNada && <div className="small muted" style={{ marginTop: 4 }}>{t("hoja.noPunches")}</div>}
          </div>
        );
      })}
    </div>
  );
}

function FilaHoja({ fila: f, dias, lang, t }: {
  fila: FilaDeLaHoja;
  dias: readonly DiaDeTurnos[];
  lang: "en" | "es";
  t: ReturnType<typeof useT>;
}) {
  const { fecha, nombreDia, domingo } = partesDelDia(f.dia, lang);
  const tramos = dias.find((d) => d.dia === f.dia)?.entradas ?? [];
  // Un día con tres tramos o más marca las pausas extra con «+N» y lista cada tramo al pasar el ratón.
  const extras = f.tramos >= 3 ? f.tramos - 2 : 0;
  const detalle = tramos
    .map((e) => `${hora(e.clock_in_at)}–${e.clock_out_at ? hora(e.clock_out_at) : "…"} (${hmm(entryMinutes(e))})`)
    .join(" · ");
  const salidaFinal = f.abierta && !f.salida ? "…" : hora(f.salida);

  return (
    <tr data-dia={f.dia} className={domingo ? "tt-hoja-domingo" : undefined}>
      <td>{fecha}</td>
      <td>{nombreDia}</td>
      <td className="tt-hoja-celda">{hora(f.entrada)}</td>
      <td className="tt-hoja-celda">{hora(f.salidaAComer)}</td>
      <td className="tt-hoja-trabajo">{hmm(f.trabajoManana)}</td>
      <td className="tt-hoja-celda">{hora(f.regresoDeComer)}</td>
      <td className="tt-hoja-fuera">
        {hmm(f.fuera)}
        {extras > 0 && (
          <span className="tt-hoja-marca" title={t("hoja.stretches", { list: detalle })}>+{extras}</span>
        )}
      </td>
      <td className="tt-hoja-celda">{salidaFinal}</td>
      <td className="tt-hoja-trabajo">{hmm(f.trabajoTarde)}</td>
      <td>{hmm(f.total)}</td>
    </tr>
  );
}
