"use client";

import { mensajeDeErrorAlCargar } from "@/lib/mensaje-de-error";

import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime, fmtMoney } from "@/lib/utils";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { hoyEnTexas } from "@/lib/almacen-ops/fecha-del-dano";
import {
  conteosDelPeriodo, colorDeExactitud, kpiDeConteos, kpiPorEmpleado, mesVecino, periodoDeMes, totalDeConteos, type KpiDeConteos,
} from "@/lib/almacen-ops/conteos-kpi";
import { DEMO_CONTEOS, faltaLa274, leerConteos, type Conteos as Datos } from "@/lib/almacen-ops/conteos-datos";
import type { Contexto } from "./Operaciones";
import { filaDeConteo, type FilaDeConteo } from "@/lib/almacen-ops/conteos-filas";
import { TarjetaConteo } from "./Conteos";
import { COLUMNAS_DE_CONTEOS, ID_TABLA_DE_CONTEOS } from "./ColumnasDeConteos";

/**
 * Operaciones de almacén (333): el INFORME de conteos de inventario, en REPORTES (pestaña «Conteos»). Dueño (19 nov):
 * «This is a table like the scrap… This is where I will see all reports… one thing is inputting and another thing is the
 * reports». Aquí van el KPI y la tabla de conteos; la pantalla de conteo no tiene nada de esto.
 * Por mes y tienda. La diferencia es DESPUÉS de las órdenes pendientes (contado − pendiente − sistema). Lo primero que se
 * lee: las CAJAS que faltan en el mes («si cada mes faltan 50 cajas, es una bandera roja»).
 */

type Carga = { estado: "cargando" } | { estado: "falta-274" } | { estado: "error"; mensaje: string } | { estado: "listo"; datos: Datos };

export function InformeDeConteos({ ctx, tiendas }: { ctx: Contexto; tiendas: string[] }) {
  const { t, lang } = usePrefs();
  const [carga, setCarga] = useState<Carga>(ctx.demo ? { estado: "listo", datos: DEMO_CONTEOS } : { estado: "cargando" });
  const [mes, setMes] = useState(() => hoyEnTexas().slice(0, 7));
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    if (ctx.demo) return;
    let vivo = true;
    leerConteos(createClient(), 400)
      .then((d) => { if (vivo) setCarga({ estado: "listo", datos: d }); })
      .catch((e) => { if (vivo) setCarga(faltaLa274(e) ? { estado: "falta-274" } : { estado: "error", mensaje: mensajeDeErrorAlCargar(e) }); });
    return () => { vivo = false; };
  }, [ctx.demo]);

  const pon = (f: (d: Datos) => Datos) => setCarga((c) => (c.estado === "listo" ? { estado: "listo", datos: f(c.datos) } : c));
  const datos = carga.estado === "listo" ? carga.datos : null;
  const periodo = periodoDeMes(mes) ?? periodoDeMes(hoyEnTexas().slice(0, 7))!;
  const etiquetaMes = useMemo(() => {
    const [y, m] = mes.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }, [mes, lang]);

  const porTienda: KpiDeConteos[] = useMemo(() => (datos ? kpiDeConteos(datos.conteos, datos.lineas, datos.pendientes, periodo, tiendas) : []), [datos, periodo, tiendas]);
  const total = useMemo(() => totalDeConteos(porTienda), [porTienda]);
  const empleados = useMemo(() => (datos ? kpiPorEmpleado(datos.conteos, datos.lineas, datos.pendientes, periodo) : []), [datos, periodo]);
  const delMes: FilaDeConteo[] = useMemo(() => {
    if (!datos) return [];
    return conteosDelPeriodo(datos.conteos, periodo).filter((c) => tiendas.includes(c.store)).map((c) =>
      filaDeConteo(c, datos.lineas.filter((l) => l.count_id === c.id), datos.pendientes.filter((o) => o.count_id === c.id))).sort((a, b) => b.c.created_at.localeCompare(a.c.created_at));
  }, [datos, periodo, tiendas]);

  const colsTienda: ColumnaEstandar<KpiDeConteos>[] = [
    { key: "tienda", en: "Store", es: "Tienda", valor: (k) => k.tienda },
    { key: "hechos", en: "Completed", es: "Completados", numerico: true, valor: (k) => k.hechos },
    { key: "exactitud", en: "Accuracy", es: "Exactitud", numerico: true, valor: (k) => k.exactitudPct, celda: (k) => (
      <span className={`ops-kpi-${colorDeExactitud(k.exactitudPct)}`}>{k.exactitudPct === null ? "—" : `${k.exactitudPct}%`}</span>) },
    { key: "cajasFaltan", en: "Missing boxes", es: "Cajas que faltan", numerico: true, valor: (k) => k.faltanCajas, celda: (k) => <span className={k.faltanCajas > 0 ? "ops-kpi-rojo" : ""} data-faltan-cajas={k.faltanCajas}>{k.faltanCajas}</span> },
    { key: "cajasSobran", en: "Over boxes", es: "Cajas que sobran", numerico: true, valor: (k) => k.sobranCajas },
    { key: "piezasSinCaja", en: "Missing pcs (no box size)", es: "Piezas que faltan (sin cajas)", numerico: true, valor: (k) => k.faltanPiezasSinCaja, oculta: true },
    { key: "faltaUsd", en: "Missing $", es: "Faltan $", numerico: true, valor: (k) => k.faltanValor, celda: (k) => fmtMoney(k.faltanValor) },
    { key: "sobraUsd", en: "Over $", es: "Sobran $", numerico: true, valor: (k) => k.sobranValor, celda: (k) => fmtMoney(k.sobranValor) },
    { key: "netoUsd", en: "Net $", es: "Neto $", numerico: true, valor: (k) => k.netoValor, celda: (k) => `${k.netoValor > 0 ? "+" : ""}${fmtMoney(k.netoValor)}` },
    { key: "pendientes", en: "Pending order pcs", es: "Pzas en órdenes pendientes", numerico: true, valor: (k) => k.pendientePiezas, oculta: true },
    { key: "abiertos", en: "Open now", es: "Abiertos ahora", numerico: true, valor: (k) => k.abiertos },
    { key: "dias", en: "Avg days", es: "Días prom.", numerico: true, valor: (k) => k.diasPromedio },
  ];

  const colsEmpleados: ColumnaEstandar<{ id: string; nombre: string; lineas: number; exactitudPct: number | null }>[] = [
    { key: "nombre", en: "Employee", es: "Empleado", valor: (e) => e.nombre },
    { key: "lineas", en: "Lines counted", es: "Líneas contadas", numerico: true, valor: (e) => e.lineas },
    { key: "exactitud", en: "Accuracy", es: "Exactitud", numerico: true, valor: (e) => e.exactitudPct, celda: (e) => (e.exactitudPct === null ? "—" : `${e.exactitudPct}%`) },
  ];

  const abiertoFila = abierto && datos ? datos.conteos.find((c) => c.id === abierto) ?? null : null;

  return (
    <section className="ops-merma ops-entregas ops-informe-conteos" data-informe-conteos data-mes={mes}>
      {carga.estado === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {carga.estado === "error" && <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>}
      {carga.estado === "falta-274" && <p className="ops-aviso">{t("Inventory counts are not set up yet (migration 274).", "Los conteos de inventario aún no están instalados (migración 274).")}</p>}

      <div className="ops-fila-de-filtros" data-fila-mes>
        <button type="button" className="btn btn-sm" onClick={() => setMes(mesVecino(mes, -1))} data-accion="mes-anterior" aria-label={t("Previous month", "Mes anterior")}>‹</button>
        <strong className="ops-informe-mes" data-etiqueta-mes>{etiquetaMes}</strong>
        <button type="button" className="btn btn-sm" onClick={() => setMes(mesVecino(mes, 1))} data-accion="mes-siguiente" aria-label={t("Next month", "Mes siguiente")}>›</button>
        {mes !== hoyEnTexas().slice(0, 7) && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMes(hoyEnTexas().slice(0, 7))} data-accion="mes-hoy">{t("This month", "Este mes")}</button>}
      </div>

      {datos && (
        <>
          {/* Lo primero: las cajas que faltan en el mes */}
          <div className="ops-merma-totales ops-kpi-conteos" data-kpi-conteos data-faltan-cajas-mes={total.faltanCajas}>
            <div className={`ops-merma-total ops-informe-principal ${total.faltanCajas > 0 ? "ops-informe-alerta" : ""}`}>
              <span>{t("Boxes missing this month", "Cajas que faltan este mes")}</span>
              <span className={`ops-merma-cifra ${total.faltanCajas > 0 ? "ops-kpi-rojo" : "ops-kpi-verde"}`} data-faltan-cajas-total>{total.faltanCajas}</span>
              <span className="hint">{total.faltanPiezasSinCaja > 0 ? `${t("plus", "más")} ${total.faltanPiezasSinCaja} ${t("pcs of products without box size", "pzas de productos sin medida de caja")}` : t("after pending orders", "después de órdenes pendientes")}</span>
            </div>
            <div className="ops-merma-total"><span>{t("Boxes over", "Cajas que sobran")}</span><span className="ops-merma-cifra" data-sobran-cajas-total>{total.sobranCajas}</span><span className="hint">{t("after pending", "tras pendientes")}</span></div>
            <div className="ops-merma-total"><span>{t("Missing $", "Faltan $")}</span><span className="ops-merma-cifra" data-faltan-usd>{fmtMoney(total.faltanValor)}</span><span className="hint">{t("over", "sobran")} {fmtMoney(total.sobranValor)}</span></div>
            <div className="ops-merma-total"><span>{t("Net $", "Neto $")}</span><span className={`ops-merma-cifra ${total.netoValor < 0 ? "ops-kpi-rojo" : ""}`} data-neto-usd>{total.netoValor > 0 ? "+" : ""}{fmtMoney(total.netoValor)}</span><span className="hint">{t("with sign", "con signo")}</span></div>
            <div className="ops-merma-total"><span>{t("Accuracy", "Exactitud")}</span><span className={`ops-merma-cifra ops-kpi-${colorDeExactitud(total.exactitudPct)}`} data-exactitud-total>{total.exactitudPct === null ? "—" : `${total.exactitudPct}%`}</span><span className="hint">{total.lineasExactas} / {total.lineasComparables} {t("lines", "líneas")}</span></div>
            <div className="ops-merma-total"><span>{t("Counts completed", "Conteos completados")}</span><span className="ops-merma-cifra" data-hechos-total>{total.hechos}</span><span className="hint">{t("adjusted this month", "ajustados este mes")}</span></div>
          </div>

          <h3 className="ops-merma-titulo">{t("By store", "Por tienda")}</h3>
          <TablaEstandar id="conteos-por-tienda" data-tabla="conteos-por-tienda" filas={porTienda} claveDe={(k) => k.tienda} columnas={colsTienda}
            vacio={t("No stores.", "No hay tiendas.")} />

          <h3 className="ops-merma-titulo">{t("Counts this month", "Conteos del mes")} <span className="count-tag">{delMes.length}</span></h3>
          <TablaEstandar id={ID_TABLA_DE_CONTEOS} data-tabla="conteos-del-mes" filas={delMes} claveDe={(f) => f.c.id} columnas={COLUMNAS_DE_CONTEOS}
            onFila={(f) => setAbierto(f.c.id)}
            vacio={t("No counts this month.", "No hay conteos en este mes.")} />

          <h3 className="ops-merma-titulo">{t("By employee", "Por empleado")}</h3>
          <TablaEstandar id="conteos-por-empleado" data-tabla="conteos-por-empleado" filas={empleados} claveDe={(e) => e.id} columnas={colsEmpleados}
            vacio={t("Nobody counted a line this month.", "Nadie contó una línea este mes.")} />
        </>
      )}

      {abiertoFila && datos && (
        <TarjetaConteo c={abiertoFila} lineas={datos.lineas.filter((l) => l.count_id === abiertoFila.id)} pendientes={datos.pendientes.filter((o) => o.count_id === abiertoFila.id)}
          ctx={ctx} pon={pon} sin333={!!datos.sin333} onCerrar={() => setAbierto(null)} />
      )}
      {carga.estado === "listo" && carga.datos.sin333 && <p className="ops-aviso" data-aviso-333>{t("Migration 333 is not applied: pending orders and system quantities at sign-off are missing from these numbers.", "La migración 333 no está aplicada: las órdenes pendientes y las cantidades del sistema no entran en estos números.")}</p>}
    </section>
  );
}
