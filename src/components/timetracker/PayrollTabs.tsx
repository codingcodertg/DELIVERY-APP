"use client";

import { useEffect, useMemo, useState } from "react";
import { getCrewNow } from "@/app/timetracker/clock-in/actions/clock";
import { idsActivosAhora } from "@/lib/timetracker/trabajando-ahora-en-nomina";
import { PayrollTimesheets } from "./PayrollTimesheets";
import { ManagerReports } from "./ManagerReports";
import { FiltrosDeNomina } from "./FiltrosDeNomina";
import type { Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import { useT } from "@/lib/timetracker/i18n";
import { useData } from "@/lib/timetracker-data-provider";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
type CrewNow = Extract<Awaited<ReturnType<typeof getCrewNow>>, { ok: true }>;

/**
 * Quién trabaja AHORA, para la lista de Nómina (2026-11-25; antes lo enseñaba la sección «Trabajando ahora»). La misma
 * definición: los del cronómetro (`liveSessions`) y los fichados (`getCrewNow().onClock`), con `idsActivosAhora`.
 * Se mira cada 10 s y al volver a la pestaña. Sin dato, o si falla, el conjunto queda como estaba (vacío al principio): todos en gris.
 * En modo demo no hay sesión: trabajan las dos primeras personas de la nómina (`demoIds`), por el mismo `idsActivosAhora`.
 */
function useQuienTrabaja(demoIds: string[]): Set<string> {
  const { liveSessions } = useData();
  const [crew, setCrew] = useState<CrewNow | null>(null);
  useEffect(() => {
    if (LOCAL_MODE) return;
    let vivo = true;
    const traer = () => { void getCrewNow().then((r) => { if (vivo && r.ok) setCrew(r); }); };
    traer();
    const id = setInterval(traer, 10_000);
    const alVolver = () => { if (!document.hidden) traer(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, []);
  const demoKey = demoIds.join(",");
  return useMemo(() => (LOCAL_MODE
    ? idsActivosAhora([], demoKey ? demoKey.split(",").map((employeeId) => ({ employeeId })) : [])
    : idsActivosAhora(liveSessions.map((s) => ({ employeeUid: s.employeeUid })), crew?.onClock ?? [])),
  [liveSessions, crew, demoKey]);
}
import type { DatosDeSemana } from "@/lib/timetracker/rango-de-nomina";
import { pasaFiltroDeNomina } from "@/lib/timetracker/filtro-de-nomina";

/**
 * La nómina de un periodo, en UNA vista (D-190).
 *
 * Arriba van los filtros (periodo, tienda y empleado) en una fila DENTRO de la página (2026-11-25: salieron de la
 * barra de arriba, donde estorbaban a la marca). Después, las dos mitades plegables: remoto y presencial.
 *
 * «Trabajando ahora» salió de aquí el 2026-11-25: quién trabaja ahora se ve en el nombre de cada persona de
 * «Hojas de tiempo» (verde si trabaja, gris si no) y ahí van primero.
 *
 * Las secciones **se montan al abrirse**, no antes: cada una pide sus propios datos y traer
 * los dos juegos para enseñar uno era pagar dos veces por una pantalla que se abre a diario.
 *
 * Las fotos de fichaje, las excepciones y las capturas de escritorio salieron de aquí el 2026-11-24
 * (decisión del dueño: la cámara de la tienda reemplaza las fotos, y las capturas se ven ahora desde el 🖥
 * de cada día o sesión remota de «Remoto»).
 */
export function PayrollTabs({ semanas, recortado, eleccion, etiqueta, hoy, filtro, revisar, errorHoras = null }: {
  /** Las semanas de pago del rango, la más antigua primero (una sola = se cierra, se paga y se aprueba). */
  semanas: string[];
  /** El rango pedido tenía más de catorce semanas y se recortó a las más recientes. */
  recortado: boolean;
  eleccion: Eleccion;
  etiqueta: string;
  hoy: string;
  /** Las tiendas y los empleados elegidos (listas; vacía = todos). */
  filtro: { tiendas: string[]; empleados: string[] };
  /** Ids de quien tiene horas por las dos vías este periodo (`period_hours.revisar`). */
  revisar: string[];
  /** Si no se pudo leer `period_hours` (la marca «revisar»), el motivo: se avisa arriba de todo. */
  errorHoras?: string | null;
}) {
  const t = useT();
  const { me } = useData();
  // Lo que cargó la pantalla de horas (personas y tiendas): alimenta los filtros y decide quién entra con ellos.
  const [datos, setDatos] = useState<DatosDeSemana | null>(null);
  // Demo: las dos primeras personas de la nómina trabajan ahora.
  const trabajando = useQuienTrabaja(datos ? datos.people.slice(0, 2).map((p) => p.id) : []);
  const unaSemana = semanas.length === 1;
  // Quién se ve con el filtro de tienda y de empleado; `null` = sin filtro (se ve todo).
  const soloUids = useMemo(() => {
    if (!filtro.tiendas.length && !filtro.empleados.length) return null;
    if (!datos) return new Set<string>();
    return new Set(datos.people
      .filter((p) => pasaFiltroDeNomina(p, filtro.tiendas, filtro.empleados))
      .map((p) => p.id));
  }, [datos, filtro.tiendas, filtro.empleados]);

  return (
    <>
      {errorHoras && <div className="banner err" style={{ marginBottom: 12 }}>{t("nomina.errHoras", { msg: errorHoras })}</div>}

      <FiltrosDeNomina uid={me.id} eleccion={eleccion} etiqueta={etiqueta} hoy={hoy}
        tiendas={filtro.tiendas} empleados={filtro.empleados} datos={datos} />
      {recortado && <p className="small muted">{t("nomina.recortado")}</p>}

      {unaSemana ? (
        <ManagerReports period={semanas[0]} soloUids={soloUids} trabajando={trabajando}
          enLista={(r) => (
            <>
              <PayrollTimesheets semanas={semanas} revisar={revisar} soloUids={soloUids} alCargarDatos={setDatos}
                trabajando={trabajando} remotos={r.bloques} barraRemota={r.barra} />
              {r.modales}
            </>
          )} />
      ) : (
        <PayrollTimesheets semanas={semanas} revisar={revisar} soloUids={soloUids} alCargarDatos={setDatos} trabajando={trabajando} />
      )}
    </>
  );
}
