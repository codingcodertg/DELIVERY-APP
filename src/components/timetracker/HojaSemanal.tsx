"use client";

import { esDiaDeHoy, hmm, type FilaDeLaHoja, type HojaDeLaSemana } from "@/lib/clockin/hoja-semanal";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import { estadoDeTrabajo } from "@/lib/timetracker/trabajando-primero";
import { entryMinutes, type PayEntry } from "@/lib/clockin/payroll";
import type { DiaDeTurnos } from "@/lib/clockin/turnos-por-dia";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { DICT, getLang, useT } from "@/lib/timetracker/i18n";
import { APP_SETTINGS } from "@/lib/timetracker/helpers";

/**
 * La hoja semanal de horas, como la del Excel de la empresa (2026-11-24): un bloque por persona y semana de pago.
 * Cada bloque es la tabla ESTÁNDAR (`TablaEstandar`) con sus columnas de siempre (ordenar, filtrar, ⚙, anchos,
 * arrastrar), y todos los bloques comparten el mismo `id`: lo que la persona oculta, mueve o ensancha vale en todos.
 * Los títulos de grupo del Excel (INICIO DEL DÍA / COMIDA / FIN DEL DÍA) van en el rótulo de cada columna.
 * Los números vienen ya calculados por `hojaDeLaSemana` (la misma aritmética que la tabla de Nómina); aquí solo se pintan.
 */
export type BloqueDeHoja = {
  id: string;
  nombre: string;
  semana: readonly string[];
  hoja: HojaDeLaSemana;
  /** Los días de la persona (`turnosPorDia`), para enseñar cada tramo en la marca «+N». */
  dias: readonly DiaDeTurnos[];
  /** Las tiendas en las que fichó esa semana (350, presencial en varias tiendas), por nombre. Vacío para los demás. */
  tiendas?: readonly string[];
};

/** Id único de la tabla estándar de la hoja: todos los bloques lo comparten (vista y anchos por persona). */
export const ID_DE_LA_HOJA = "tt-hoja-semanal";

const LOCALE = (lang: "en" | "es") => (lang === "es" ? "es-MX" : "en-US");

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_SETTINGS.timeZone }) : "";

/** `28-Nov` y el nombre del día en mayúsculas (`FRIDAY`). */
function partesDelDia(dia: string, lang: "en" | "es") {
  const [y, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d, 12));
  const loc = LOCALE(lang);
  const mes = fecha.toLocaleDateString(loc, { month: "short", timeZone: "UTC" }).replace(".", "");
  return {
    fecha: `${d}-${mes}`,
    nombreDia: fecha.toLocaleDateString(loc, { weekday: "long", timeZone: "UTC" }).toLocaleUpperCase(loc),
  };
}

/** `28 Nov – 4 Dec`: el rango de la semana de pago del bloque. */
function rotuloSemana(semana: readonly string[], lang: "en" | "es"): string {
  const corto = (dia: string) => {
    const [y, m, d] = dia.split("-").map(Number);
    return `${d} ${new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(LOCALE(lang), { month: "short", timeZone: "UTC" }).replace(".", "")}`;
  };
  return `${corto(semana[0])} – ${corto(semana[semana.length - 1])}`;
}

/** Lo que la tabla necesita de cada día: la fila de la hoja más lo que sale de sus tramos y de su fecha. */
type FilaDeTabla = {
  f: FilaDeLaHoja;
  fecha: string;
  nombreDia: string;
  /** Hoy (día de Texas): la fila se resalta. */
  hoy: boolean;
  /** Las horas de cada tramo, para la marca «+N» (`title`). */
  detalle: string;
};

/** Las columnas, en el orden del Excel. Cada rótulo lleva su grupo («Inicio · Entrada», …). */
const COLUMNAS: readonly ColumnaEstandar<FilaDeTabla>[] = [
  { key: "dia", ...rotulo("hoja.c.dia"), valor: (r) => r.f.dia, celda: (r) => r.fecha },
  { key: "nombreDia", ...rotulo("hoja.c.nombreDia"), valor: (r) => r.nombreDia, celda: (r) => r.nombreDia },
  { key: "entrada", ...rotulo("hoja.c.inicioEntrada"), clase: "tt-hoja-celda", valor: (r) => r.f.entrada, celda: (r) => hora(r.f.entrada) },
  { key: "salidaAComer", ...rotulo("hoja.c.inicioSalida"), clase: "tt-hoja-celda", valor: (r) => r.f.salidaAComer, celda: (r) => hora(r.f.salidaAComer) },
  { key: "trabajoManana", ...rotulo("hoja.c.inicioTrabajado"), clase: "num tt-hoja-trabajo", numerico: true, valor: (r) => r.f.trabajoManana, celda: (r) => hmm(r.f.trabajoManana) },
  { key: "regresoDeComer", ...rotulo("hoja.c.comidaRegreso"), clase: "tt-hoja-celda", valor: (r) => r.f.regresoDeComer, celda: (r) => hora(r.f.regresoDeComer) },
  { key: "fuera", ...rotulo("hoja.c.comidaFuera"), clase: "num tt-hoja-fuera", numerico: true, valor: (r) => r.f.fuera,
    celda: (r) => (
      <>
        {hmm(r.f.fuera)}
        {r.f.tramos >= 3 && <span className="tt-hoja-marca" title={r.detalle}>+{r.f.tramos - 2}</span>}
      </>
    ) },
  { key: "salida", ...rotulo("hoja.c.finSalida"), clase: "tt-hoja-celda", valor: (r) => r.f.salida,
    celda: (r) => (r.f.abierta && !r.f.salida ? "…" : hora(r.f.salida)) },
  { key: "trabajoTarde", ...rotulo("hoja.c.finTrabajado"), clase: "num tt-hoja-trabajo", numerico: true, valor: (r) => r.f.trabajoTarde, celda: (r) => hmm(r.f.trabajoTarde) },
  { key: "total", ...rotulo("hoja.c.total"), clase: "num", numerico: true, valor: (r) => r.f.total, celda: (r) => hmm(r.f.total) },
];

/** Un rótulo bilingüe de una clave de i18n: `{ en, es }` para la tabla estándar. */
function rotulo(clave: string): { en: string; es: string } {
  return { en: DICT.en[clave] ?? clave, es: DICT.es[clave] ?? clave };
}

export function HojaSemanal({ bloques, trabajando }: {
  bloques: BloqueDeHoja[];
  /** Quién trabaja ahora: su nombre va en verde; los demás, en gris. */
  trabajando?: ReadonlySet<string>;
}) {
  const hoy = hoyEnTexas();
  const t = useT();
  const lang = getLang();

  return (
    <div>
      {bloques.map((b) => {
        const sinNada = b.hoja.filas.every((f) => f.sinFichaje);
        const filas: FilaDeTabla[] = b.hoja.filas.map((f) => {
          const p = partesDelDia(f.dia, lang);
          const tramos = b.dias.find((d) => d.dia === f.dia)?.entradas ?? [];
          return { f, fecha: p.fecha, nombreDia: p.nombreDia, hoy: esDiaDeHoy(f.dia, hoy), detalle: detalleDeTramos(tramos) };
        });
        return (
          <section key={`${b.id}-${b.semana[0]}`} className="tt-hoja-bloque" data-hoja-de={b.id} data-sobre={String(b.hoja.sobre)}
            style={{ marginTop: 12 }}>
            <div className="tt-hoja-cabecera">
              <span className="tt-hoja-nombre tt-nombre-de-trabajo" data-trabajando={estadoDeTrabajo(b.id, trabajando)}
                title={estadoDeTrabajo(b.id, trabajando) === "si" ? t("hoja.working") : t("hoja.notWorking")}>{b.nombre}</span>
              <span className="small muted">{rotuloSemana(b.semana, lang)}</span>
              {b.tiendas && b.tiendas.length > 0 && (
                <span className="small muted">{t("hoja.stores")}: {b.tiendas.join(" · ")}</span>
              )}
            </div>
            <TablaEstandar<FilaDeTabla>
              id={ID_DE_LA_HOJA}
              data-tabla={ID_DE_LA_HOJA}
              columnas={COLUMNAS}
              filas={filas}
              claveDe={(r) => r.f.dia}
              ordenInicial={{ clave: "dia", direccion: "asc" }}
              claseTabla="tt-hoja"
              claseDeFila={(r) => (r.hoy ? "tt-hoja-hoy" : undefined)}
              sinCaja
              vacio={t("hoja.noPunches")}
            />
            <div className="tt-hoja-pie">
              <span className={b.hoja.sobre ? "tt-hoja-sobre" : "tt-hoja-neutro"}>
                {b.hoja.sobre ? t("hoja.over") : t("hoja.atOrBelow")}
              </span>
              <span className="small muted">{t("hoja.totHrs")}</span>
              <span className="tt-hoja-total">{hmm(b.hoja.total)}</span>
            </div>
            {sinNada && <div className="small muted" style={{ marginTop: 4 }}>{t("hoja.noPunches")}</div>}
          </section>
        );
      })}
    </div>
  );
}

/** «7:54 AM–3:56 PM (8:02) · 4:54 PM–5:56 PM (1:02)»: cada tramo del día, para el `title` de la marca «+N». */
function detalleDeTramos(tramos: readonly PayEntry[]): string {
  return tramos
    .map((e) => `${hora(e.clock_in_at)}–${e.clock_out_at ? hora(e.clock_out_at) : "…"} (${hmm(entryMinutes(e))})`)
    .join(" · ");
}
