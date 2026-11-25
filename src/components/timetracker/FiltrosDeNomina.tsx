"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HUECO_DE_LA_BARRA } from "@/components/BarraDeApp";
import { MenuDeFecha } from "@/components/MenuDeFecha";
import type { Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import { parametrosDeRango, rangoDeLaEleccion, type DatosDeSemana } from "@/lib/timetracker/rango-de-nomina";
import { getLang, useT } from "@/lib/timetracker/i18n";

/** Lo que recuerda la app por persona, solo para preseleccionar la próxima visita SIN parámetros en la URL. */
const claveDeFiltros = (uid: string) => `tt-nomina-filtros:${uid}`;

/**
 * Los filtros de Nómina: periodo (menú de fechas), tienda y empleado. Van DENTRO de la barra de arriba, justo después
 * de la marca (`HUECO_DE_LA_BARRA`), en una sola fila. Sin hueco (primer pintado), salen como fila de la página.
 *
 * La URL manda: el periodo (`?period=` o `?desde=&hasta=`), la tienda (`?tienda=`) y el empleado (`?empleado=`).
 * Cambiar cualquiera navega con esos parámetros; la pantalla los lee del servidor y de la URL, no de un estado propio.
 */
export function FiltrosDeNomina({ uid, eleccion, etiqueta, hoy, tienda, empleado, datos }: {
  uid: string;
  eleccion: Eleccion;
  etiqueta: string;
  hoy: string;
  tienda: string | null;
  empleado: string | null;
  /** Las personas y tiendas cargadas (de `PayrollTimesheets`); `null` mientras no llegan. */
  datos: DatosDeSemana | null;
}) {
  const t = useT();
  const lang = getLang();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [hueco, setHueco] = useState<HTMLElement | null>(null);
  useEffect(() => { setHueco(document.getElementById(HUECO_DE_LA_BARRA)); }, []);

  // Sin parámetros, la visita abre con lo último que eligió esta persona (si lo hubo).
  useEffect(() => {
    if (!params || params.has("period") || params.has("desde") || params.has("tienda") || params.has("empleado")) return;
    try {
      const guardado = window.localStorage.getItem(claveDeFiltros(uid));
      if (!guardado) return;
      const q = new URLSearchParams(JSON.parse(guardado) as Record<string, string>).toString();
      if (q) router.replace(`${pathname}?${q}`);
    } catch {
      // Sin almacén o con un valor viejo: se queda la semana de hoy.
    }
    // Solo al entrar: cambiar un filtro después lo navega la propia elección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [desdeMano, setDesdeMano] = useState(eleccion.desde);
  const [hastaMano, setHastaMano] = useState(eleccion.hasta || "");

  /** Navega con los parámetros dados (null quita el parámetro) y lo recuerda para la próxima visita. */
  function ir(cambios: Record<string, string | null>) {
    const q = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(cambios)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const texto = q.toString();
    try {
      const recordar: Record<string, string> = {};
      for (const k of ["period", "desde", "hasta", "tienda", "empleado"]) {
        const v = q.get(k);
        if (v) recordar[k] = v;
      }
      window.localStorage.setItem(claveDeFiltros(uid), JSON.stringify(recordar));
    } catch {
      // Sin almacén: la próxima visita sin parámetros vuelve a la semana de hoy.
    }
    router.push(texto ? `${pathname}?${texto}` : pathname);
  }

  function elegirAtajo(a: Eleccion["atajo"]) {
    if (a === "otro") {
      // «Rango personalizado»: se abren Desde / Hasta; la URL cambia cuando las dos fechas cuadran.
      setDesdeMano(eleccion.desde);
      setHastaMano(eleccion.hasta);
      return;
    }
    const r = rangoDeLaEleccion({ atajo: a, desde: "", hasta: "" }, hoy);
    const p = r ? parametrosDeRango(r) : null;
    if (!p) return;
    ir("period" in p ? { period: p.period, desde: null, hasta: null } : { desde: p.desde, hasta: p.hasta, period: null });
  }

  function cambiaRangoAMano(desde: string, hasta: string) {
    setDesdeMano(desde);
    setHastaMano(hasta);
    if (desde && hasta && desde <= hasta) {
      const p = parametrosDeRango({ desde, hasta });
      if (p) ir("period" in p ? { period: p.period, desde: null, hasta: null } : { desde: p.desde, hasta: p.hasta, period: null });
    }
  }

  // Las tiendas con gente en la nómina, y las personas de la tienda elegida (por nombre).
  const tiendas = datos ? datos.stores.filter((s) => datos.people.some((p) => p.store === s.key)) : [];
  const personas = (datos?.people ?? [])
    .filter((p) => !tienda || p.store === tienda)
    .sort((a, b) => a.name.localeCompare(b.name));

  function cambiaTienda(v: string) {
    // Si la persona elegida no es de esa tienda, el filtro de persona se quita.
    const sigue = !!v && !!empleado && !!datos?.people.some((p) => p.id === empleado && p.store === v);
    ir({ tienda: v || null, empleado: sigue ? empleado : null });
  }

  const bloque = (
    <div className="tt-nomina-en-la-barra" data-nomina-en-la-barra>
      <MenuDeFecha eleccion={eleccion} etiqueta={etiqueta} onElegir={elegirAtajo} lang={lang} titulo={t("nomina.periodo")} />
      {eleccion.atajo === "otro" && (
        <>
          <input type="date" className="tt-nomina-fecha" data-rango-desde value={desdeMano} aria-label={t("nomina.desde")}
            onChange={(e) => cambiaRangoAMano(e.target.value, hastaMano)} />
          <input type="date" className="tt-nomina-fecha" data-rango-hasta value={hastaMano} aria-label={t("nomina.hasta")}
            onChange={(e) => cambiaRangoAMano(desdeMano, e.target.value)} />
        </>
      )}
      <select className="tt-nomina-select" data-tienda-de-nomina value={tienda ?? ""} aria-label={t("nomina.tienda")}
        onChange={(e) => cambiaTienda(e.target.value)}>
        <option value="">🏬 {t("nomina.todasTiendas")}</option>
        {tiendas.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
      </select>
      <select className="tt-nomina-select" data-empleado-de-nomina value={empleado ?? ""} aria-label={t("nomina.empleado")}
        onChange={(e) => ir({ empleado: e.target.value || null })} disabled={!datos}>
        <option value="">👤 {t("nomina.todosEmpleados")}</option>
        {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );

  // Dentro de la barra, en la ranura de la marca; si la barra no tiene ranura, es una fila más de la página.
  return hueco ? createPortal(bloque, hueco) : <div className="tt-fila-de-nomina" data-fila-de-nomina>{bloque}</div>;
}
