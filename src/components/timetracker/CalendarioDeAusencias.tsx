"use client";

import { useEffect, useState } from "react";
import { getCalendarioDeAusencias } from "@/app/timetracker/clock-in/actions/timeoff";
import { getLang, useT } from "@/lib/timetracker/i18n";
import {
  ausentesPorDia,
  cuadriculaDelMes,
  mesVecino,
  recorteDeDia,
  type Ausencia,
} from "@/lib/timetracker/calendario-de-ausencias";

/**
 * Quién falta en qué días (D-1155, ayuda de Roberto, 24 nov 2026). Solo lectura: aprobar y
 * denegar se hace en la lista, no aquí.
 *
 * Cada celda enseña el número del día y, debajo, los nombres de quien está fuera. Las pendientes
 * salen igual pero con línea discontinua y la palabra «pendiente», para distinguirlas de las
 * aprobadas a simple vista.
 *
 * Los datos se piden solo para la cuadrícula visible (seis semanas, incluidas las de los meses
 * vecinos), no para toda la compañía ni para todo el año.
 */
export function CalendarioDeAusencias() {
  const t = useT();
  const lang = getLang();
  const hoy = (() => {
    const h = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${h.getFullYear()}-${p(h.getMonth() + 1)}-${p(h.getDate())}`;
  })();

  const [mes, setMes] = useState(() => {
    const h = new Date();
    return { anio: h.getFullYear(), mes: h.getMonth() + 1 };
  });
  const cuadricula = cuadriculaDelMes(mes.anio, mes.mes, hoy);
  // El día elegido: su lista completa sale debajo de la cuadrícula. En un teléfono los nombres de la celda se cortan
  // («Zule…») y con más de tres personas la celda dice «+N más»; el día se toca y se lee entero. Empieza en hoy.
  const [elegido, setElegido] = useState<string | null>(hoy);
  const desde = cuadricula[0].fecha;
  const hasta = cuadricula[cuadricula.length - 1].fecha;
  const clave = desde + "|" + hasta;

  // La respuesta lleva la clave de su rango: si se cambió de mes antes de que llegara, no se pinta.
  const [resultado, setResultado] = useState<
    { clave: string; ausencias: Ausencia[] } | { clave: string; error: string } | null
  >(null);
  useEffect(() => {
    let vigente = true;
    getCalendarioDeAusencias(desde, hasta).then((res) => {
      if (!vigente) return;
      setResultado(res.ok
        ? { clave, ausencias: res.ausencias }
        : { clave, error: res.message });
    });
    return () => { vigente = false; };
  }, [desde, hasta, clave]);

  const cargando = resultado === null || resultado.clave !== clave;
  const ausencias = resultado && "ausencias" in resultado && resultado.clave === clave ? resultado.ausencias : [];
  const porDia = ausentesPorDia(ausencias, cuadricula.map((d) => d.fecha));

  // Nombres de los días de la semana, empezando en domingo. Son fechas fijas (4 ene 2026 fue
  // domingo), así que el nombre sale del idioma de la pantalla y no de una tabla a mano.
  const locale = lang === "es" ? "es-ES" : "en-US";
  const nombresDeSemana = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + i))));
  const titulo = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(mes.anio, mes.mes - 1, 1)));

  return (
    <div className="tt-calendario">
      <div className="tt-calendario-cabecera">
        <button type="button" className="tt-calendario-nav" aria-label={t("mgr.inbox.calPrev")}
          onClick={() => setMes(mesVecino(mes.anio, mes.mes, -1))}>‹</button>
        <span className="tt-calendario-mes">{titulo}</span>
        <button type="button" className="tt-calendario-nav" aria-label={t("mgr.inbox.calNext")}
          onClick={() => setMes(mesVecino(mes.anio, mes.mes, 1))}>›</button>
      </div>

      {resultado && "error" in resultado && resultado.clave === clave ? (
        <div className="banner err">{resultado.error}</div>
      ) : (
        <>
          <div className="tt-calendario-semana" aria-hidden="true">
            {nombresDeSemana.map((n, i) => <span key={i}>{n}</span>)}
          </div>
          <div className="tt-calendario-rejilla">
            {cuadricula.map((d) => {
              const fuera = porDia.get(d.fecha) ?? [];
              const { visibles, restantes } = recorteDeDia(fuera);
              // Con «+N más», la celda enseña la lista entera al pasar el ratón.
              const todos = fuera
                .map((a) => (a.pendiente ? `${a.nombre} (${t("mgr.inbox.calPending")})` : a.nombre))
                .join(", ");
              const clases = ["tt-calendario-dia"];
              if (!d.delMes) clases.push("tt-calendario-fuera");
              if (d.hoy) clases.push("tt-calendario-hoy");
              return (
                <button type="button" key={d.fecha} className={clases.join(" ")} title={restantes > 0 ? todos : undefined}
                  data-dia={d.fecha} aria-pressed={elegido === d.fecha} onClick={() => setElegido(d.fecha)}>
                  <span className="tt-calendario-num">{d.dia}</span>
                  {visibles.map((a) => (
                    <span key={a.id} className={a.pendiente ? "tt-calendario-persona tt-calendario-pendiente" : "tt-calendario-persona"}>
                      {a.pendiente ? `${a.nombre} · ${t("mgr.inbox.calPending")}` : a.nombre}
                    </span>
                  ))}
                  {restantes > 0 && <span className="tt-calendario-mas">{t("mgr.inbox.calMore", { n: restantes })}</span>}
                </button>
              );
            })}
          </div>
          {cargando && <div className="hint">{t("mgr.inbox.loading")}</div>}
          {elegido && cuadricula.some((d) => d.fecha === elegido) && (() => {
            const fuera = porDia.get(elegido) ?? [];
            const [a, m, dd] = elegido.split("-").map(Number);
            const fechaLarga = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
              .format(new Date(Date.UTC(a, m - 1, dd)));
            return (
              <div className="tt-calendario-detalle" data-detalle-del-dia={elegido}>
                <b className="tt-calendario-detalle-fecha">{fechaLarga}</b>
                {fuera.length === 0 ? (
                  <span className="small muted">{t("mgr.inbox.calNobody")}</span>
                ) : (
                  <ul>
                    {fuera.map((x) => (
                      <li key={x.id}>
                        <b>{x.nombre}</b>
                        <span className="small muted"> · {x.tipo === "sick" ? t("mgr.inbox.offSick") : t("mgr.inbox.offVacation")}
                          {x.pendiente ? " · " + t("mgr.inbox.calPending") : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
