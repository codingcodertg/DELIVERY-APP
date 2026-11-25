"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MenuDeFecha } from "@/components/MenuDeFecha";
import type { Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import { parametrosDeRango, rangoDeLaEleccion, type DatosDeSemana } from "@/lib/timetracker/rango-de-nomina";
import { listaParaUrl } from "@/lib/timetracker/filtro-de-nomina";
import { MenuDeVarios } from "./MenuDeVarios";
import { getLang, useT } from "@/lib/timetracker/i18n";

/** Lo que recuerda la app por persona, solo para preseleccionar la próxima visita SIN parámetros en la URL. */
const claveDeFiltros = (uid: string) => `tt-nomina-filtros:${uid}`;

/**
 * Los filtros de Nómina: periodo (menú de fechas), tienda y empleado. Van en la PÁGINA, arriba de «Hojas de tiempo» (2026-11-25: ya no van en la barra de arriba), en una fila (en un teléfono, la fila se parte).
 *
 * La URL manda: el periodo (`?period=` o `?desde=&hasta=`), la tienda (`?tienda=`) y el empleado (`?empleado=`), cada uno con una lista separada por comas.
 * Cambiar cualquiera navega con esos parámetros; la pantalla los lee del servidor y de la URL, no de un estado propio.
 */
export function FiltrosDeNomina({ uid, eleccion, etiqueta, hoy, tiendas, empleados, datos }: {
  uid: string;
  eleccion: Eleccion;
  etiqueta: string;
  hoy: string;
  tiendas: string[];
  empleados: string[];
  /** Las personas y tiendas cargadas (de `PayrollTimesheets`); `null` mientras no llegan. */
  datos: DatosDeSemana | null;
}) {
  const t = useT();
  const lang = getLang();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

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

  // Las tiendas con gente en la nómina, y las personas de las tiendas elegidas (por nombre).
  const tiendasDisponibles = datos ? datos.stores.filter((s) => datos.people.some((p) => p.store === s.key)) : [];
  const personas = (datos?.people ?? [])
    .filter((p) => tiendas.length === 0 || (p.store != null && tiendas.includes(p.store)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nombreDeTienda = (id: string) => tiendasDisponibles.find((x) => x.key === id)?.name ?? id;
  const nombreDePersona = (id: string) => datos?.people.find((p) => p.id === id)?.name ?? id;

  function cambiaTiendas(ids: string[]) {
    // Si una persona elegida no es de ninguna de las tiendas elegidas, su filtro se quita.
    const quedan = ids.length === 0
      ? empleados
      : empleados.filter((e) => !!datos?.people.some((p) => p.id === e && p.store != null && ids.includes(p.store)));
    ir({ tienda: listaParaUrl(ids), empleado: listaParaUrl(quedan) });
  }

  function cambiaEmpleados(ids: string[]) {
    ir({ empleado: listaParaUrl(ids) });
  }

  // El texto del botón: nada elegido = todos (sin filtrar); uno = su nombre; varios = «N tiendas» con la lista en el título.
  const textoTiendas = tiendas.length === 0 ? t("nomina.todasTiendas") : tiendas.length === 1 ? nombreDeTienda(tiendas[0]) : t("nomina.nTiendas", { n: tiendas.length });
  const textoEmpleados = empleados.length === 0 ? t("nomina.todosEmpleados") : empleados.length === 1 ? nombreDePersona(empleados[0]) : t("nomina.nEmpleados", { n: empleados.length });
  const ayudaTiendas = tiendas.length === 0 ? t("nomina.todasTiendas") : tiendas.map(nombreDeTienda).join(" · ");
  const ayudaEmpleados = empleados.length === 0 ? t("nomina.todosEmpleados") : empleados.map(nombreDePersona).join(" · ");

  const bloque = (
    <div className="tt-nomina-en-la-pagina" data-nomina-en-la-pagina>
      <MenuDeFecha eleccion={eleccion} etiqueta={etiqueta} onElegir={elegirAtajo} lang={lang} titulo={t("nomina.periodo")} />
      {eleccion.atajo === "otro" && (
        <>
          <input type="date" className="tt-nomina-fecha" data-rango-desde value={desdeMano} aria-label={t("nomina.desde")}
            onChange={(e) => cambiaRangoAMano(e.target.value, hastaMano)} />
          <input type="date" className="tt-nomina-fecha" data-rango-hasta value={hastaMano} aria-label={t("nomina.hasta")}
            onChange={(e) => cambiaRangoAMano(desdeMano, e.target.value)} />
        </>
      )}
      <MenuDeVarios dato="tienda" titulo={{ en: "Stores", es: "Tiendas" }} lang={lang} texto={textoTiendas} ayuda={ayudaTiendas}
        elegidos={tiendas} onCambia={cambiaTiendas}
        opciones={tiendasDisponibles.map((x) => ({ key: x.key, label: x.name }))} />
      <MenuDeVarios dato="empleado" titulo={{ en: "Employees", es: "Empleados" }} lang={lang} texto={textoEmpleados} ayuda={ayudaEmpleados}
        elegidos={empleados} onCambia={cambiaEmpleados} disabled={!datos}
        opciones={personas.map((p) => ({ key: p.id, label: p.name }))} />
    </div>
  );

  return bloque;
}
