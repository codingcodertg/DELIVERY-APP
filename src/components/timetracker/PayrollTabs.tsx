"use client";

import { useMemo, useState } from "react";
import { PayrollTimesheets } from "./PayrollTimesheets";
import { ManagerReports } from "./ManagerReports";
import { FiltrosDeNomina } from "./FiltrosDeNomina";
import type { Eleccion } from "@/lib/almacen-ops/rango-de-merma";
import { useT } from "@/lib/timetracker/i18n";
import { useData } from "@/lib/timetracker-data-provider";
import type { DatosDeSemana } from "@/lib/timetracker/rango-de-nomina";

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
  filtro: { tienda: string | null; empleado: string | null };
  /** Ids de quien tiene horas por las dos vías este periodo (`period_hours.revisar`). */
  revisar: string[];
  /** Si no se pudo leer `period_hours` (la marca «revisar»), el motivo: se avisa arriba de todo. */
  errorHoras?: string | null;
}) {
  const t = useT();
  const { me } = useData();
  // Lo que cargó la pantalla de horas (personas y tiendas): alimenta los filtros y decide quién entra con ellos.
  const [datos, setDatos] = useState<DatosDeSemana | null>(null);
  const unaSemana = semanas.length === 1;
  // Quién se ve con el filtro de tienda y de empleado; `null` = sin filtro (se ve todo).
  const soloUids = useMemo(() => {
    if (!filtro.tienda && !filtro.empleado) return null;
    if (!datos) return new Set<string>();
    return new Set(datos.people
      .filter((p) => (!filtro.tienda || p.store === filtro.tienda) && (!filtro.empleado || p.id === filtro.empleado))
      .map((p) => p.id));
  }, [datos, filtro.tienda, filtro.empleado]);

  return (
    <>
      {errorHoras && <div className="banner err" style={{ marginBottom: 12 }}>{t("nomina.errHoras", { msg: errorHoras })}</div>}

      <FiltrosDeNomina uid={me.id} eleccion={eleccion} etiqueta={etiqueta} hoy={hoy}
        tienda={filtro.tienda} empleado={filtro.empleado} datos={datos} />
      {recortado && <p className="small muted">{t("nomina.recortado")}</p>}

      <Seccion titulo={t("mgr.pay.remoteTitle")} nota={t("mgr.pay.remoteNote")}>
        {unaSemana
          ? <ManagerReports period={semanas[0]} soloUids={soloUids} />
          : <p className="banner warn">{t("nomina.soloUnaSemana")}</p>}
      </Seccion>

      <Seccion titulo={t("mgr.pay.onSiteTitle")} nota={t("mgr.pay.onSiteNote")} abierta>
        <PayrollTimesheets semanas={semanas} revisar={revisar} soloUids={soloUids} alCargarDatos={setDatos} />
      </Seccion>
    </>
  );
}

/**
 * Una mitad de la nómina, plegable.
 *
 * Dos pantallas grandes seguidas son ochocientas líneas de alto; sin plegar, la segunda
 * mitad no existe para quien no baja hasta abajo. Se usa `<details>` del navegador y no un
 * acordeón propio por lo de siempre: recuerda el foco, se busca dentro con Ctrl+F, y no hay
 * nada escrito que pueda fallar.
 *
 * `onToggle` monta el contenido la primera vez que se abre. Lo que ya se abrió se queda
 * montado: volver a cerrarlo y abrirlo no debería costar otra carga.
 */
function Seccion({
  titulo, nota, abierta = false, children,
}: {
  titulo: string;
  nota: string;
  abierta?: boolean;
  children: React.ReactNode;
}) {
  const [montada, setMontada] = useState(abierta);

  return (
    <details
      open={abierta}
      style={{ marginBottom: 16 }}
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setMontada(true); }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 15, padding: "6px 0" }}>
        {titulo}
        <span className="muted small" style={{ marginLeft: 10, fontWeight: 400 }}>{nota}</span>
      </summary>
      {montada && children}
    </details>
  );
}
